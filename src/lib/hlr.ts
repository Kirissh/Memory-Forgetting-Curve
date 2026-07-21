import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "./db";
import { cosineSimilarity } from "./embeddings";
import {
  PRIOR_WEIGHTS,
  FEATURE_NAMES,
  buildFeatures,
  fitHalfLifeMLE,
  meanNegLogLik,
  predictHalfLife,
  predictRecall,
  daysToRecallLevel,
  explainWhy,
  contributionTerms,
  daysBetween,
  alignWeights,
  memoryAnchor,
} from "./retention";
import type { TrainingRow } from "./retention";
import { replaySm2, type Sm2Review } from "./sm2";
import {
  replayFsrs,
  fitFsrs,
  nextState,
  initStability,
  initDifficulty,
  DEFAULT_FSRS_PARAMS,
  type FsrsGrade,
  type FsrsReview,
  type FsrsState,
} from "./fsrs";
import { calibration } from "./calibration";
import {
  bootstrapWeights,
  recallIntervalAt,
  type BootstrapRow,
} from "./uncertainty";
import {
  scheduleWithWorkload,
  buildIcs,
  type ScheduleInput,
} from "./scheduler";
import { detectLeech, rankLeeches } from "./leech";
import type {
  Concept,
  ModelWeights,
  ModelScore,
  CalibrationBinDTO,
  Review,
} from "./types";

const MIN_REVIEWS_TO_TRAIN = 10;

/** Reviews between 22:00 and 05:59 UTC count as "late night" for consolidation. */
function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

/**
 * Study-habit aggregates over a card's *full* review trail (sorted chronologically) —
 * the cached values live scoring reads off the concept row. `buildLabeledRows` derives
 * the leakage-safe as-of versions for training; this is the whole-history counterpart
 * used to refresh the row on retrain and after each live review. All three read only
 * timestamps and prior gaps, never the current lag, so they stay Δt-free.
 */
export function behaviorAggregates(
  trail: { reviewedAt: string; daysSinceLastReview: number }[]
): { nightStudyRate: number; massedPracticeRate: number; studyRoutine: number } {
  let night = 0;
  let hourSin = 0;
  let hourCos = 0;
  let gaps = 0;
  let massed = 0;
  trail.forEach((r, i) => {
    const hour = new Date(r.reviewedAt).getUTCHours();
    if (isNightHour(hour)) night += 1;
    const angle = (2 * Math.PI * hour) / 24;
    hourSin += Math.sin(angle);
    hourCos += Math.cos(angle);
    if (i > 0) {
      gaps += 1;
      if (r.daysSinceLastReview < 0.5) massed += 1;
    }
  });
  const n = trail.length || 1;
  return {
    nightStudyRate: night / n,
    studyRoutine: Math.hypot(hourSin, hourCos) / n,
    massedPracticeRate: gaps ? massed / gaps : 0,
  };
}

function getWeightsForUser(
  modelWeights: ModelWeights[],
  userId: string
): number[] {
  const row = modelWeights.find((m) => m.userId === userId);
  return alignWeights(row?.weights);
}

function scoreConcept(
  concept: Concept,
  weights: number[],
  userConcepts: Concept[],
  userConceptIds: Set<string>,
  embMap: Map<string, number[]>,
  now: string
) {
  const anchor = memoryAnchor(concept);
  const days = daysBetween(anchor, now);
  const sim = concept.chunkId
    ? masteredPeerSim(concept, userConcepts, userConceptIds, embMap)
    : 0;
  const features = buildFeatures({
    correctStreak: concept.correctStreak,
    incorrectCount: concept.incorrectCount,
    totalReviews: concept.totalReviews,
    avgDaysBetweenReviews: concept.avgDaysBetweenReviews,
    conceptEmbeddingSimilarity: sim,
    avgReadTimeMs: concept.avgReadTimeMs,
    avgResponseTimeMs: concept.avgResponseTimeMs,
    trapFailRate: concept.trapFailRate,
    avgDifficulty: concept.avgDifficulty,
    nightStudyRate: concept.nightStudyRate,
    massedPracticeRate: concept.massedPracticeRate,
    studyRoutine: concept.studyRoutine,
  });
  const halfLife = predictHalfLife(weights, features);
  const recall = predictRecall(halfLife, days);
  return { features, halfLife, recall, days, anchor };
}

export async function retrainUserModel(userId: string): Promise<ModelWeights> {
  const db = await readDb();
  const reviews = db.reviews
    .filter((r) => r.userId === userId)
    .sort(
      (a, b) =>
        new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()
    );

  let weights = [...PRIOR_WEIGHTS];
  let heldOutLogLoss: number | null = null;
  let baselineLogLoss: number | null = null;
  let trainedOn = 0;
  let comparison: ModelScore[] | undefined;
  let calibrationBins: CalibrationBinDTO[] | undefined;
  let fsrsParams: number[] | undefined;

  if (reviews.length >= MIN_REVIEWS_TO_TRAIN) {
    const conceptsById = new Map(db.concepts.map((c) => [c.id, c]));
    const embMap = new Map(db.chunks.map((c) => [c.id, c.embedding]));

    // Replay once over the full history, then split in time. Each row's features
    // already depend only on reviews before it, so the split stays honest.
    const labeled = buildLabeledRows(reviews, conceptsById, embMap);
    const allRows = labeled.map((l) => l.row);
    const split = Math.max(1, Math.floor(allRows.length * 0.85));
    const trainRows = allRows.slice(0, split);
    const holdOut = allRows.slice(split);

    if (trainRows.length >= 5) {
      weights = fitHalfLifeMLE(trainRows, PRIOR_WEIGHTS);
      trainedOn = trainRows.length;

      if (holdOut.length > 0) {
        heldOutLogLoss = meanNegLogLik(holdOut, weights);
        baselineLogLoss = meanNegLogLik(holdOut, PRIOR_WEIGHTS);
      }
    }

    // Head-to-head: HLR vs prior vs SM-2 vs FSRS on the same held-out predictions.
    const cmp = computeComparison(reviews, labeled, weights, split);
    comparison = cmp.comparison;
    calibrationBins = cmp.calibrationBins;
    fsrsParams = cmp.fsrsParams;
  }

  const record: ModelWeights = {
    id: uuid(),
    userId,
    weights,
    featureNames: [...FEATURE_NAMES],
    trainedOnReviewCount: trainedOn || reviews.length,
    heldOutLogLoss,
    baselineLogLoss,
    trainedAt: new Date().toISOString(),
    comparison,
    calibrationBins,
    fsrsParams,
  };

  // Replay each concept's trail to its current FSRS state, cached on the concept row.
  const fsrsFinal = new Map<
    string,
    { state: FsrsState; reps: number; lapses: number }
  >();
  for (const trail of reviewsByConcept(reviews)) {
    let state: FsrsState | null = null;
    let reps = 0;
    let lapses = 0;
    for (const r of trail) {
      const grade = fsrsGradeFromReview(r);
      state = advanceFsrsState(state, grade, r.daysSinceLastReview);
      reps += 1;
      if (grade === 1) lapses += 1;
    }
    if (state) fsrsFinal.set(trail[0].conceptId, { state, reps, lapses });
  }

  // Whole-history study-habit aggregates, refreshed onto each concept so live scoring
  // reads the same signal the fit just trained on.
  const behaviorByConcept = new Map<
    string,
    ReturnType<typeof behaviorAggregates>
  >();
  for (const trail of reviewsByConcept(reviews)) {
    behaviorByConcept.set(trail[0].conceptId, behaviorAggregates(trail));
  }

  await updateDb((d) => {
    d.modelWeights = d.modelWeights.filter((m) => m.userId !== userId);
    d.modelWeights.push(record);

    const embMap = new Map(d.chunks.map((c) => [c.id, c.embedding]));
    const userConceptIds = new Set(
      d.cards
        .filter((c) => {
          const mat = d.materials.find((m) => m.id === c.materialId);
          return mat?.userId === userId;
        })
        .map((c) => c.conceptId)
    );
    const userConcepts = d.concepts.filter((c) => userConceptIds.has(c.id));
    const now = new Date().toISOString();

    for (const concept of d.concepts) {
      if (!userConceptIds.has(concept.id)) continue;
      const bag = behaviorByConcept.get(concept.id);
      if (bag) {
        concept.nightStudyRate = bag.nightStudyRate;
        concept.massedPracticeRate = bag.massedPracticeRate;
        concept.studyRoutine = bag.studyRoutine;
      }
      const scored = scoreConcept(
        concept,
        weights,
        userConcepts,
        userConceptIds,
        embMap,
        now
      );
      concept.halfLifeDays = scored.halfLife;
      concept.recallProbability = scored.recall;
      const f = fsrsFinal.get(concept.id);
      if (f) {
        concept.stability = f.state.stability;
        concept.fsrsDifficulty = f.state.difficulty;
        concept.fsrsReps = f.reps;
        concept.fsrsLapses = f.lapses;
      }
    }
  });

  return record;
}

function masteredPeerSim(
  concept: Concept,
  concepts: Concept[],
  userConceptIds: Set<string>,
  embMap: Map<string, number[]>
): number {
  const my = concept.chunkId ? embMap.get(concept.chunkId) : null;
  if (!my) return 0;
  let best = 0;
  for (const c of concepts) {
    if (!userConceptIds.has(c.id) || c.id === concept.id) continue;
    if (c.correctStreak < 2) continue;
    const emb = c.chunkId ? embMap.get(c.chunkId) : null;
    if (!emb) continue;
    best = Math.max(best, cosineSimilarity(my, emb));
  }
  return best;
}

/** A concept's counters as of some instant — the mirror of what POST /api/reviews writes. */
interface ReplayState {
  correctStreak: number;
  incorrectCount: number;
  totalReviews: number;
  avgDaysBetweenReviews: number;
  lastReviewedAt: string | null;
  avgReadTimeMs?: number;
  avgResponseTimeMs?: number;
  trapExposures: number;
  trapFails: number;
  trapFailRate: number;
  avgDifficulty?: number;
  difficultyCount: number;
  /** Study-habit accumulators — the running sums behind the three habit features. */
  nightCount: number;
  hourSin: number;
  hourCos: number;
  gapCount: number;
  massedCount: number;
}

function emptyState(): ReplayState {
  return {
    correctStreak: 0,
    incorrectCount: 0,
    totalReviews: 0,
    avgDaysBetweenReviews: 0,
    lastReviewedAt: null,
    trapExposures: 0,
    trapFails: 0,
    trapFailRate: 0,
    difficultyCount: 0,
    nightCount: 0,
    hourSin: 0,
    hourCos: 0,
    gapCount: 0,
    massedCount: 0,
  };
}

/** masteredPeerSim, restricted to what was already mastered at this point in the walk. */
function peerSimAsOf(
  concept: Concept,
  state: Map<string, ReplayState>,
  conceptsById: Map<string, Concept>,
  embMap: Map<string, number[]>
): number {
  const my = concept.chunkId ? embMap.get(concept.chunkId) : null;
  if (!my) return 0;
  let best = 0;
  for (const [id, s] of state) {
    if (id === concept.id || s.correctStreak < 2) continue;
    const peer = conceptsById.get(id);
    const emb = peer?.chunkId ? embMap.get(peer.chunkId) : null;
    if (!emb) continue;
    best = Math.max(best, cosineSimilarity(my, emb));
  }
  return best;
}

/**
 * Replay the user's whole history forward, emitting each review's features as they
 * stood *just before* that review resolved.
 *
 * Reading them off the concept row instead (the obvious shortcut) hands every
 * historical row the counters the concept carries *today* — so a review answered
 * wrong three weeks ago trains against the 4-hit streak it only earned later. The
 * features would know their own future, and a held-out split can't catch it because
 * the held-out rows are contaminated the same way.
 *
 * Everything here must therefore stay a strict function of prior reviews — no field
 * off `concept`, and nothing from `r` except its lag and its outcome. That also keeps
 * training aligned with what `scoreConcept` can actually see when it ranks.
 */
/** A training row plus the labels a fair held-out comparison needs. */
export interface LabeledRow {
  conceptId: string;
  /** First review of this concept in the walk — no prior evidence to predict from. */
  isFirst: boolean;
  reviewedAt: string;
  row: TrainingRow;
}

/**
 * Chronological replay tagging each row with its concept, first-review flag, and
 * timestamp — everything `buildTrainingRows` produces, plus the labels the model
 * comparison uses to align an honest held-out split across HLR / SM-2 / FSRS.
 */
export function buildLabeledRows(
  reviews: Review[],
  conceptsById: Map<string, Concept>,
  embMap: Map<string, number[]>
): LabeledRow[] {
  const state = new Map<string, ReplayState>();
  const labeled: LabeledRow[] = [];

  for (const r of reviews) {
    const concept = conceptsById.get(r.conceptId);
    if (!concept) continue;
    const isFirst = !state.has(r.conceptId);
    let s = state.get(r.conceptId);
    if (!s) {
      s = emptyState();
      state.set(r.conceptId, s);
    }

    const row: TrainingRow = {
      features: buildFeatures({
        correctStreak: s.correctStreak,
        incorrectCount: s.incorrectCount,
        totalReviews: s.totalReviews,
        avgDaysBetweenReviews: s.avgDaysBetweenReviews,
        conceptEmbeddingSimilarity: peerSimAsOf(
          concept,
          state,
          conceptsById,
          embMap
        ),
        avgReadTimeMs: s.avgReadTimeMs,
        avgResponseTimeMs: s.avgResponseTimeMs,
        trapFailRate: s.trapFailRate,
        avgDifficulty: s.avgDifficulty,
        // As-of the reviews before this one — the same guarantee the counters above give.
        nightStudyRate: s.totalReviews ? s.nightCount / s.totalReviews : 0,
        studyRoutine: s.totalReviews
          ? Math.hypot(s.hourSin, s.hourCos) / s.totalReviews
          : 0,
        massedPracticeRate: s.gapCount ? s.massedCount / s.gapCount : 0,
      }),
      deltaTDays: Math.max(r.daysSinceLastReview, 0.01),
      correct: r.correct,
    };
    labeled.push({
      conceptId: r.conceptId,
      isFirst,
      reviewedAt: r.reviewedAt,
      row,
    });

    // Advance — same arithmetic as the review route, so replayed state matches live state.
    s.totalReviews += 1;
    if (r.correct) {
      s.correctStreak += 1;
    } else {
      s.correctStreak = 0;
      s.incorrectCount += 1;
    }

    const n = s.totalReviews;
    if (r.readTimeMs && r.readTimeMs > 0) {
      s.avgReadTimeMs =
        ((s.avgReadTimeMs || r.readTimeMs) * (n - 1) + r.readTimeMs) / n;
    }
    if (r.responseTimeMs && r.responseTimeMs > 0) {
      s.avgResponseTimeMs =
        ((s.avgResponseTimeMs || r.responseTimeMs) * (n - 1) + r.responseTimeMs) /
        n;
    }
    if (typeof r.probeWasSameMeaning === "boolean" && !r.probeWasSameMeaning) {
      s.trapExposures += 1;
      if (r.trapFailed) s.trapFails += 1;
      s.trapFailRate = s.trapFails / Math.max(s.trapExposures, 1);
    }
    if (s.lastReviewedAt) {
      const gap = daysBetween(s.lastReviewedAt, r.reviewedAt);
      s.avgDaysBetweenReviews =
        ((s.avgDaysBetweenReviews || gap) * (n - 1) + gap) / n;
    }
    if (typeof r.difficulty === "number") {
      s.difficultyCount += 1;
      const k = s.difficultyCount;
      s.avgDifficulty =
        ((s.avgDifficulty ?? r.difficulty) * (k - 1) + r.difficulty) / k;
    }
    // Study-habit accumulators. Night/hour count every review; the massed gap counts
    // only once a prior review exists, and reads this row's gap — a past gap for the
    // rows that follow, never the current label's lag.
    const hour = new Date(r.reviewedAt).getUTCHours();
    if (isNightHour(hour)) s.nightCount += 1;
    const angle = (2 * Math.PI * hour) / 24;
    s.hourSin += Math.sin(angle);
    s.hourCos += Math.cos(angle);
    if (s.lastReviewedAt) {
      s.gapCount += 1;
      if (r.daysSinceLastReview < 0.5) s.massedCount += 1;
    }
    s.lastReviewedAt = r.reviewedAt;
  }

  return labeled;
}

/** Plain training rows (features + Δt + outcome), the fitter's input. */
export function buildTrainingRows(
  reviews: Review[],
  conceptsById: Map<string, Concept>,
  embMap: Map<string, number[]>
): TrainingRow[] {
  return buildLabeledRows(reviews, conceptsById, embMap).map((l) => l.row);
}

// ── Cross-model comparison: HLR vs the cold-start prior vs SM-2 vs FSRS ──────────

/** Map a logged binary review to an FSRS 1–4 grade using EOL difficulty + latency. */
export function fsrsGradeFromReview(r: Review): FsrsGrade {
  if (!r.correct) return 1; // Again
  const diff = r.difficulty ?? 3; // ease-of-learning 1–5
  const slow = (r.responseTimeMs ?? 0) > 6000;
  if (diff <= 2 && !slow) return 4; // Easy — felt trivial and answered fast
  if (diff >= 4 || slow) return 2; // Hard — felt tough or retrieval was slow
  return 3; // Good
}

/** Group a user's reviews into per-concept trails, each sorted chronologically. */
function reviewsByConcept(reviews: Review[]): Review[][] {
  const byId = new Map<string, Review[]>();
  for (const r of reviews) {
    const arr = byId.get(r.conceptId) ?? [];
    arr.push(r);
    byId.set(r.conceptId, arr);
  }
  const trails: Review[][] = [];
  for (const arr of byId.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()
    );
    trails.push(arr);
  }
  return trails;
}

interface ComparisonResult {
  comparison: ModelScore[];
  calibrationBins: CalibrationBinDTO[];
  fsrsParams: number[];
}

/**
 * Score trained HLR, the cold-start prior, SM-2, and FSRS head-to-head on the SAME
 * pooled predictions, held out honestly: only reviews at or after `splitTime` count,
 * and each concept's first review (no prior evidence) is dropped. FSRS is *fit* only
 * on the pre-split reviews, so nothing trains on what it is scored against. When the
 * held-out slice is too thin to be meaningful, falls back to in-sample scoring so the
 * dashboard still has numbers (flagged by the caller via trainedOnReviewCount).
 */
function computeComparison(
  reviews: Review[],
  labeled: LabeledRow[],
  weights: number[],
  splitIndex: number
): ComparisonResult {
  const holdoutSize = reviews.length - splitIndex;
  const heldOut = splitIndex < reviews.length && holdoutSize >= 8;
  const splitTime = heldOut
    ? new Date(reviews[splitIndex].reviewedAt).getTime()
    : -Infinity; // in-sample fallback: score everything

  const inScore = (reviewedAt: string) =>
    new Date(reviewedAt).getTime() >= splitTime;

  // HLR + prior: predict recall from each held-out row's features.
  const hlrPreds: { p: number; correct: boolean }[] = [];
  const priorPreds: { p: number; correct: boolean }[] = [];
  for (const l of labeled) {
    if (l.isFirst || !inScore(l.reviewedAt)) continue;
    const { features, deltaTDays, correct } = l.row;
    hlrPreds.push({
      p: predictRecall(predictHalfLife(weights, features), deltaTDays),
      correct,
    });
    priorPreds.push({
      p: predictRecall(predictHalfLife(PRIOR_WEIGHTS, features), deltaTDays),
      correct,
    });
  }

  // Per-concept trails for the sequential models.
  const trails = reviewsByConcept(reviews);
  const fsrsFitTrails: FsrsReview[][] = [];
  for (const trail of trails) {
    const trainPortion = trail.filter((r) => !inScore(r.reviewedAt));
    const src = trainPortion.length >= 2 ? trainPortion : trail;
    fsrsFitTrails.push(
      src.map((r) => ({
        grade: fsrsGradeFromReview(r),
        deltaTDays: Math.max(r.daysSinceLastReview, 0),
      }))
    );
  }
  const fsrsParams = fitFsrs(fsrsFitTrails);

  const sm2Preds: { p: number; correct: boolean }[] = [];
  const fsrsPreds: { p: number; correct: boolean }[] = [];
  for (const trail of trails) {
    const sm2Trail: Sm2Review[] = trail.map((r) => ({
      correct: r.correct,
      deltaTDays: Math.max(r.daysSinceLastReview, 0),
    }));
    const fsrsTrail: FsrsReview[] = trail.map((r) => ({
      grade: fsrsGradeFromReview(r),
      deltaTDays: Math.max(r.daysSinceLastReview, 0),
    }));
    replaySm2(sm2Trail).forEach((pr, i) => {
      if (pr.isFirst || !inScore(trail[i].reviewedAt)) return;
      sm2Preds.push({ p: pr.predictedRecall, correct: pr.correct });
    });
    replayFsrs(fsrsTrail, fsrsParams).forEach((pr, i) => {
      if (pr.isFirst || !inScore(trail[i].reviewedAt)) return;
      fsrsPreds.push({ p: pr.predictedRecall, correct: pr.correct });
    });
  }

  const score = (name: string, preds: { p: number; correct: boolean }[]) => {
    const c = calibration(preds);
    return {
      name,
      logLoss: c.logLoss,
      brier: c.brier,
      ece: c.ece,
      accuracy: c.accuracy,
      n: c.n,
    };
  };

  return {
    comparison: [
      score("HLR (trained)", hlrPreds),
      score("Prior (cold-start)", priorPreds),
      score("FSRS", fsrsPreds),
      score("SM-2", sm2Preds),
    ],
    calibrationBins: calibration(hlrPreds).bins,
    fsrsParams,
  };
}

/** Evolve a concept's stored FSRS state by one review (mirrors POST /api/reviews). */
export function advanceFsrsState(
  prev: FsrsState | null,
  grade: FsrsGrade,
  deltaTDays: number
): FsrsState {
  if (!prev) {
    return {
      stability: initStability(grade, DEFAULT_FSRS_PARAMS),
      difficulty: initDifficulty(grade, DEFAULT_FSRS_PARAMS),
    };
  }
  return nextState(prev, grade, Math.max(deltaTDays, 0), DEFAULT_FSRS_PARAMS);
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export type ForgetBand = "faded" | "fading" | "safe";

export interface CurvePoint {
  conceptId: string;
  title: string;
  halfLifeDays: number;
  /** ISO timestamp the decay clock runs from (last test, else last learn, else creation) */
  anchor: string;
  daysSinceAnchor: number;
  recallNow: number;
  /** Age in days at which this memory decays to the threshold */
  ageAtThreshold: number;
  /** ISO timestamp of the threshold crossing — "when you'll forget it" */
  forgetAt: string;
  /** Days from now to the crossing; negative means it already passed */
  daysUntilForget: number;
  band: ForgetBand;
  status: "tested" | "learned" | "new";
  correctStreak: number;
  incorrectCount: number;
  totalReviews: number;
  why: string;
  /** Bootstrap 80% band on recall-now — wide when little data backs the fit. */
  recallP10: number;
  recallP90: number;
  /** FSRS per-card stability (days), when the card has review history. */
  stabilityDays: number | null;
  isLeech: boolean;
  leechReasons: string[];
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Project every learned concept onto its own forgetting curve and solve for the
 * date it drops through `threshold`. Same weights and features as the queue —
 * this reads the model rather than re-deriving it, so the two always agree.
 */
export async function getForgettingCurve(
  userId: string,
  opts: { threshold?: number; fadingWithinDays?: number } = {}
) {
  const threshold = Math.min(Math.max(opts.threshold ?? 0.5, 0.05), 0.95);
  const fadingWithinDays = opts.fadingWithinDays ?? 7;

  const db = await readDb();
  const weights = getWeightsForUser(db.modelWeights, userId);
  const embMap = new Map(db.chunks.map((c) => [c.id, c.embedding]));

  const userMaterials = new Set(
    db.materials.filter((m) => m.userId === userId).map((m) => m.id)
  );
  const userConcepts = db.concepts.filter((c) =>
    userMaterials.has(c.materialId)
  );
  const userConceptIds = new Set(userConcepts.map((c) => c.id));

  // Bootstrap the HLR weights once (reused across concepts) so each curve carries a
  // confidence band that widens when little review history backs the fit.
  const conceptsById = new Map(db.concepts.map((c) => [c.id, c]));
  const bootRows: BootstrapRow[] = buildLabeledRows(
    db.reviews
      .filter((r) => r.userId === userId)
      .sort(
        (a, b) =>
          new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()
      ),
    conceptsById,
    embMap
  ).map((l) => ({
    features: l.row.features,
    deltaTDays: l.row.deltaTDays,
    correct: l.row.correct,
  }));
  const weightSamples = bootstrapWeights(
    bootRows,
    PRIOR_WEIGHTS,
    (rows, prior) => fitHalfLifeMLE(rows as TrainingRow[], prior),
    { B: 40 }
  );

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  const concepts: CurvePoint[] = userConcepts.map((concept) => {
    const scored = scoreConcept(
      concept,
      weights,
      userConcepts,
      userConceptIds,
      embMap,
      nowIso
    );
    const recallBand = recallIntervalAt(
      weightSamples,
      scored.features,
      predictHalfLife,
      scored.days
    );
    const leech = detectLeech({
      conceptId: concept.id,
      title: concept.title,
      totalReviews: concept.totalReviews,
      incorrectCount: concept.incorrectCount,
      correctStreak: concept.correctStreak,
      halfLifeDays: scored.halfLife,
      trapFailRate: concept.trapFailRate,
    });
    const ageAtThreshold = daysToRecallLevel(scored.halfLife, threshold);
    const daysUntilForget = ageAtThreshold - scored.days;
    const band: ForgetBand =
      daysUntilForget <= 0
        ? "faded"
        : daysUntilForget <= fadingWithinDays
          ? "fading"
          : "safe";

    return {
      conceptId: concept.id,
      title: concept.title,
      halfLifeDays: scored.halfLife,
      anchor: scored.anchor,
      daysSinceAnchor: scored.days,
      recallNow: scored.recall,
      ageAtThreshold,
      forgetAt: new Date(
        new Date(scored.anchor).getTime() + ageAtThreshold * MS_PER_DAY
      ).toISOString(),
      daysUntilForget,
      band,
      status: concept.lastReviewedAt
        ? ("tested" as const)
        : concept.lastLearnedAt
          ? ("learned" as const)
          : ("new" as const),
      correctStreak: concept.correctStreak,
      incorrectCount: concept.incorrectCount,
      totalReviews: concept.totalReviews,
      why: explainWhy(weights, scored.features, scored.halfLife),
      recallP10: recallBand.p10,
      recallP90: recallBand.p90,
      stabilityDays: concept.stability ?? null,
      isLeech: leech.isLeech,
      leechReasons: leech.reasons,
    };
  });

  // Soonest-to-forget first — the ones worth acting on lead.
  concepts.sort((a, b) => a.daysUntilForget - b.daysUntilForget);

  const model = db.modelWeights.find((m) => m.userId === userId);

  return {
    concepts,
    threshold,
    fadingWithinDays,
    now: nowIso,
    nowMs,
    summary: {
      faded: concepts.filter((c) => c.band === "faded").length,
      fading: concepts.filter((c) => c.band === "fading").length,
      safe: concepts.filter((c) => c.band === "safe").length,
      medianHalfLife: median(concepts.map((c) => c.halfLifeDays)),
    },
    model: {
      usingPrior: (model?.trainedOnReviewCount ?? 0) < MIN_REVIEWS_TO_TRAIN,
      trainedOnReviewCount: model?.trainedOnReviewCount ?? 0,
      trainedAt: model?.trainedAt ?? null,
    },
  };
}

export async function getTodayQueue(userId: string, limit = 20) {
  const db = await readDb();
  const weights = getWeightsForUser(db.modelWeights, userId);
  const embMap = new Map(db.chunks.map((c) => [c.id, c.embedding]));

  const userMaterials = new Set(
    db.materials.filter((m) => m.userId === userId).map((m) => m.id)
  );
  const userConcepts = db.concepts.filter((c) =>
    userMaterials.has(c.materialId)
  );
  const userConceptIds = new Set(userConcepts.map((c) => c.id));
  const cardsByConcept = new Map<string, (typeof db.cards)[0]>();
  for (const card of db.cards) {
    if (userMaterials.has(card.materialId)) {
      cardsByConcept.set(card.conceptId, card);
    }
  }

  // Personal spacing from this user's review history (when available)
  const positiveGaps = db.reviews
    .filter((r) => r.userId === userId && r.daysSinceLastReview > 0.02)
    .map((r) => r.daysSinceLastReview);
  const personalGap =
    positiveGaps.length >= 3 ? median(positiveGaps) : null;

  const now = new Date().toISOString();
  const raw = userConcepts
    .map((concept) => {
      const scored = scoreConcept(
        concept,
        weights,
        userConcepts,
        userConceptIds,
        embMap,
        now
      );
      const card = cardsByConcept.get(concept.id);
      if (!card) return null;
      const leech = detectLeech({
        conceptId: concept.id,
        title: concept.title,
        totalReviews: concept.totalReviews,
        incorrectCount: concept.incorrectCount,
        correctStreak: concept.correctStreak,
        halfLifeDays: scored.halfLife,
        trapFailRate: concept.trapFailRate,
      });
      return {
        conceptId: concept.id,
        cardId: card.id,
        materialId: card.materialId,
        isLeech: leech.isLeech,
        leechReasons: leech.reasons,
        title: concept.title,
        definition: concept.definition,
        front: card.front ?? concept.title,
        back: card.back ?? concept.definition,
        clozeText: card.clozeText ?? null,
        clozeAnswer: card.clozeAnswer ?? null,
        halfLifeDays: scored.halfLife,
        daysSinceAnchor: scored.days,
        recallNow: scored.recall,
        features: scored.features,
        lastReviewedAt: concept.lastReviewedAt,
        lastLearnedAt: concept.lastLearnedAt ?? null,
        correctStreak: concept.correctStreak,
        incorrectCount: concept.incorrectCount,
        avgDifficulty: concept.avgDifficulty ?? null,
        avgReadTimeMs: concept.avgReadTimeMs ?? null,
        trapFailRate: concept.trapFailRate ?? 0,
        why: explainWhy(weights, scored.features, scored.halfLife),
        status: concept.lastReviewedAt
          ? ("tested" as const)
          : concept.lastLearnedAt
            ? ("learned" as const)
            : ("new" as const),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  // Compare cards at a shared horizon from THIS user's model (median half-life).
  // Instantaneous P≈100% right after a session; relative fade risk still differs by h.
  const medianHalfLife = median(raw.map((r) => r.halfLifeDays));
  const horizonDays = personalGap ?? medianHalfLife;

  const items = raw
    .map((r) => {
      const projected = predictRecall(r.halfLifeDays, horizonDays);
      const fadeRisk = 1 - projected;
      // Prefer real elapsed-time recall once the card has aged; else use projection
      const aged = r.daysSinceAnchor >= horizonDays * 0.25;
      const recallProbability = aged ? r.recallNow : projected;
      return {
        conceptId: r.conceptId,
        cardId: r.cardId,
        title: r.title,
        definition: r.definition,
        front: r.front,
        back: r.back,
        clozeText: r.clozeText,
        clozeAnswer: r.clozeAnswer,
        recallProbability,
        recallNow: r.recallNow,
        projectedRecall: projected,
        fadeRisk,
        halfLifeDays: r.halfLifeDays,
        daysSinceAnchor: r.daysSinceAnchor,
        horizonDays,
        lastReviewedAt: r.lastReviewedAt,
        lastLearnedAt: r.lastLearnedAt,
        correctStreak: r.correctStreak,
        incorrectCount: r.incorrectCount,
        avgDifficulty: r.avgDifficulty,
        avgReadTimeMs: r.avgReadTimeMs,
        trapFailRate: r.trapFailRate,
        why: r.why,
        forgettingRisk: fadeRisk,
        status: r.status,
        materialId: r.materialId,
        isLeech: r.isLeech,
        leechReasons: r.leechReasons,
      };
    })
    .sort((a, b) => b.fadeRisk - a.fadeRisk || a.halfLifeDays - b.halfLifeDays);

  const cut = Math.max(3, Math.ceil(items.length / 3));
  // Interleave the study order so a multi-deck session never drills one source in a
  // row (desirable-difficulty spacing). Single-material decks pass through unchanged,
  // so the "weakest first" ordering the UI promises still holds for the demo.
  const ranked = interleaveByMaterial(items).slice(0, limit);
  const weakTopics = items.slice(0, Math.min(cut, 8));

  const model = db.modelWeights.find((m) => m.userId === userId);

  return {
    items: ranked,
    weakTopics,
    horizonDays,
    medianHalfLife,
    model: model
      ? {
          trainedAt: model.trainedAt,
          trainedOnReviewCount: model.trainedOnReviewCount,
          heldOutLogLoss: model.heldOutLogLoss,
          baselineLogLoss: model.baselineLogLoss,
          usingPrior: model.trainedOnReviewCount < MIN_REVIEWS_TO_TRAIN,
          weights: model.weights,
          featureNames: model.featureNames,
        }
      : {
          usingPrior: true,
          trainedOnReviewCount: 0,
          weights: [...PRIOR_WEIGHTS],
          featureNames: [...FEATURE_NAMES],
        },
  };
}

/**
 * Round-robin a risk-sorted deck across its source materials so no single source
 * runs three-in-a-row (interleaving / desirable difficulty). Among the buckets whose
 * head differs from the last pick, take the globally highest-priority head (lowest
 * original index); fall back to repeating a source only when nothing else remains.
 * Single-material decks return unchanged, so the demo's "weakest first" order holds.
 */
function interleaveByMaterial<T extends { materialId: string }>(items: T[]): T[] {
  const buckets = new Map<string, { idx: number; item: T }[]>();
  items.forEach((item, idx) => {
    const b = buckets.get(item.materialId) ?? [];
    b.push({ idx, item });
    buckets.set(item.materialId, b);
  });
  if (buckets.size <= 1) return items;

  const out: T[] = [];
  let last: string | null = null;
  while (out.length < items.length) {
    let best: { material: string; idx: number } | null = null;
    let fallback: { material: string; idx: number } | null = null;
    for (const [material, b] of buckets) {
      if (b.length === 0) continue;
      const head = b[0];
      if (!fallback || head.idx < fallback.idx) fallback = { material, idx: head.idx };
      if (material === last) continue;
      if (!best || head.idx < best.idx) best = { material, idx: head.idx };
    }
    const chosen: { material: string; idx: number } | null = best ?? fallback;
    if (!chosen) break;
    out.push(buckets.get(chosen.material)!.shift()!.item);
    last = chosen.material;
  }
  return out;
}

/**
 * Turn the current half-life estimates into a concrete review calendar: each card's
 * optimal next date (when recall decays to the target), workload-spread under a daily
 * cap, plus an .ics feed the user can subscribe to. Closes the loop from "what's
 * fading" to "when to review each thing".
 */
export async function getSchedule(
  userId: string,
  opts: { targetRetention?: number; dailyCap?: number } = {}
) {
  const db = await readDb();
  const weights = getWeightsForUser(db.modelWeights, userId);
  const embMap = new Map(db.chunks.map((c) => [c.id, c.embedding]));
  const userMaterials = new Set(
    db.materials.filter((m) => m.userId === userId).map((m) => m.id)
  );
  const userConcepts = db.concepts.filter((c) =>
    userMaterials.has(c.materialId)
  );
  const userConceptIds = new Set(userConcepts.map((c) => c.id));

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const inputs: ScheduleInput[] = userConcepts.map((concept) => {
    const scored = scoreConcept(
      concept,
      weights,
      userConcepts,
      userConceptIds,
      embMap,
      nowIso
    );
    return {
      conceptId: concept.id,
      title: concept.title,
      halfLifeDays: scored.halfLife,
      anchorMs: new Date(scored.anchor).getTime(),
    };
  });

  const target = Math.min(Math.max(opts.targetRetention ?? 0.9, 0.5), 0.98);
  const dailyCap = Math.max(1, Math.floor(opts.dailyCap ?? 8));
  const result = scheduleWithWorkload(inputs, {
    targetRetention: target,
    dailyCap,
    nowMs,
    horizonDays: 60,
  });
  const ics = buildIcs(result.items, nowMs, { calName: "Recall Reviews" });
  const model = db.modelWeights.find((m) => m.userId === userId);

  return {
    ...result,
    nowMs,
    ics,
    dueToday: result.items.filter((i) => i.daysFromNow < 1).length,
    dueThisWeek: result.items.filter((i) => i.daysFromNow < 7).length,
    shiftedCount: result.items.filter((i) => i.shifted).length,
    model: {
      usingPrior: (model?.trainedOnReviewCount ?? 0) < MIN_REVIEWS_TO_TRAIN,
      trainedOnReviewCount: model?.trainedOnReviewCount ?? 0,
    },
  };
}

/**
 * Aggregate everything the analytics dashboard shows: the head-to-head model
 * comparison + reliability bins (from the last retrain), accuracy over time, which
 * features drive this learner's half-lives, and the current leeches.
 */
export async function getInsights(userId: string) {
  const db = await readDb();
  const model = db.modelWeights.find((m) => m.userId === userId);
  const weights = getWeightsForUser(db.modelWeights, userId);
  const embMap = new Map(db.chunks.map((c) => [c.id, c.embedding]));
  const userMaterials = new Set(
    db.materials.filter((m) => m.userId === userId).map((m) => m.id)
  );
  const userConcepts = db.concepts.filter((c) =>
    userMaterials.has(c.materialId)
  );
  const userConceptIds = new Set(userConcepts.map((c) => c.id));
  const reviews = db.reviews
    .filter((r) => r.userId === userId)
    .sort(
      (a, b) =>
        new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()
    );
  const nowIso = new Date().toISOString();
  const DAY = 1000 * 60 * 60 * 24;

  // Accuracy over time, weekly buckets from the first review.
  const trend: { weekStart: string; accuracy: number; n: number }[] = [];
  if (reviews.length) {
    const start = new Date(reviews[0].reviewedAt).getTime();
    const byWeek = new Map<number, { correct: number; n: number }>();
    for (const r of reviews) {
      const wk = Math.floor((new Date(r.reviewedAt).getTime() - start) / (7 * DAY));
      const b = byWeek.get(wk) ?? { correct: 0, n: 0 };
      b.n += 1;
      if (r.correct) b.correct += 1;
      byWeek.set(wk, b);
    }
    for (const [wk, b] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
      trend.push({
        weekStart: new Date(start + wk * 7 * DAY).toISOString(),
        accuracy: b.correct / b.n,
        n: b.n,
      });
    }
  }

  // Feature drivers: mean signed contribution (w_i · x_i) across the user's concepts.
  const driverSums = new Array<number>(FEATURE_NAMES.length).fill(0);
  const halfLives: number[] = [];
  const stabilities: number[] = [];
  let scoredCount = 0;
  for (const concept of userConcepts) {
    const scored = scoreConcept(
      concept,
      weights,
      userConcepts,
      userConceptIds,
      embMap,
      nowIso
    );
    for (const t of contributionTerms(weights, scored.features)) {
      const idx = FEATURE_NAMES.indexOf(t.name as (typeof FEATURE_NAMES)[number]);
      if (idx >= 0) driverSums[idx] += t.value;
    }
    scoredCount += 1;
    halfLives.push(scored.halfLife);
    if (concept.stability != null) stabilities.push(concept.stability);
  }
  const drivers = FEATURE_NAMES.map((name, i) => ({
    name,
    weight: weights[i],
    prior: PRIOR_WEIGHTS[i],
    meanContribution: scoredCount ? driverSums[i] / scoredCount : 0,
  }))
    .filter((d) => d.name !== "bias")
    .sort((a, b) => Math.abs(b.meanContribution) - Math.abs(a.meanContribution));

  const leeches = rankLeeches(
    userConcepts.map((c) => ({
      conceptId: c.id,
      title: c.title,
      totalReviews: c.totalReviews,
      incorrectCount: c.incorrectCount,
      correctStreak: c.correctStreak,
      halfLifeDays: c.halfLifeDays,
      trapFailRate: c.trapFailRate,
    }))
  ).filter((v) => v.isLeech);

  const totalCorrect = reviews.filter((r) => r.correct).length;

  return {
    model: model
      ? {
          trainedAt: model.trainedAt,
          trainedOnReviewCount: model.trainedOnReviewCount,
          usingPrior:
            (model.trainedOnReviewCount ?? 0) < MIN_REVIEWS_TO_TRAIN,
          heldOutLogLoss: model.heldOutLogLoss,
          baselineLogLoss: model.baselineLogLoss,
          comparison: model.comparison ?? [],
          calibrationBins: model.calibrationBins ?? [],
          fsrsParams: model.fsrsParams ?? null,
        }
      : null,
    trend,
    drivers,
    leeches,
    featureNames: [...FEATURE_NAMES],
    weights,
    prior: [...PRIOR_WEIGHTS],
    summary: {
      concepts: userConcepts.length,
      totalReviews: reviews.length,
      accuracy: reviews.length ? totalCorrect / reviews.length : 0,
      medianHalfLife: median(halfLives),
      medianStability: stabilities.length ? median(stabilities) : null,
    },
  };
}
