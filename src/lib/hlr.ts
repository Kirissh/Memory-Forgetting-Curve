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
  daysBetween,
  alignWeights,
  memoryAnchor,
} from "./retention";
import type { TrainingRow } from "./retention";
import type { Concept, ModelWeights, Review } from "./types";

const MIN_REVIEWS_TO_TRAIN = 10;

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

  if (reviews.length >= MIN_REVIEWS_TO_TRAIN) {
    const conceptsById = new Map(db.concepts.map((c) => [c.id, c]));
    const embMap = new Map(db.chunks.map((c) => [c.id, c.embedding]));

    // Replay once over the full history, then split in time. Each row's features
    // already depend only on reviews before it, so the split stays honest.
    const allRows = buildTrainingRows(reviews, conceptsById, embMap);
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
  };

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
export function buildTrainingRows(
  reviews: Review[],
  conceptsById: Map<string, Concept>,
  embMap: Map<string, number[]>
): TrainingRow[] {
  const state = new Map<string, ReplayState>();
  const rows: TrainingRow[] = [];

  for (const r of reviews) {
    const concept = conceptsById.get(r.conceptId);
    if (!concept) continue;
    let s = state.get(r.conceptId);
    if (!s) {
      s = emptyState();
      state.set(r.conceptId, s);
    }

    rows.push({
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
      }),
      deltaTDays: Math.max(r.daysSinceLastReview, 0.01),
      correct: r.correct,
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
    s.lastReviewedAt = r.reviewedAt;
  }

  return rows;
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
      return {
        conceptId: concept.id,
        cardId: card.id,
        title: concept.title,
        definition: concept.definition,
        front: card.front ?? concept.title,
        back: card.back ?? concept.definition,
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
      };
    })
    .sort((a, b) => b.fadeRisk - a.fadeRisk || a.halfLifeDays - b.halfLifeDays);

  const cut = Math.max(3, Math.ceil(items.length / 3));
  const ranked = items.slice(0, limit);
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
