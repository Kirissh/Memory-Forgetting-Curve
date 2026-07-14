import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "./db";
import { cosineSimilarity } from "./embeddings";
import {
  PRIOR_WEIGHTS,
  FEATURE_NAMES,
  buildFeatures,
  fitRidge,
  observedHalfLife,
  predictHalfLife,
  predictRecall,
  explainWhy,
  logLoss,
  daysBetween,
  alignWeights,
  memoryAnchor,
} from "./retention";
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
    daysSinceLastReview: days,
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
    const split = Math.max(1, Math.floor(reviews.length * 0.85));
    const trainSet = reviews.slice(0, split);
    const holdOut = reviews.slice(split);

    const rows = buildTrainingRows(trainSet, db.concepts);
    if (rows.X.length >= 5) {
      weights = fitRidge(rows.X, rows.y, 1.0);
      trainedOn = trainSet.length;

      if (holdOut.length > 0) {
        const evalRows = buildTrainingRows(holdOut, db.concepts, true);
        let hlrLoss = 0;
        let baseLoss = 0;
        for (let i = 0; i < evalRows.outcomes.length; i++) {
          const h = predictHalfLife(weights, evalRows.X[i]);
          const p = predictRecall(h, evalRows.deltaTs[i]);
          hlrLoss += logLoss(p, evalRows.outcomes[i]);

          const h0 = predictHalfLife(PRIOR_WEIGHTS, evalRows.X[i]);
          const p0 = predictRecall(h0, evalRows.deltaTs[i]);
          baseLoss += logLoss(p0, evalRows.outcomes[i]);
        }
        heldOutLogLoss = hlrLoss / evalRows.outcomes.length;
        baselineLogLoss = baseLoss / evalRows.outcomes.length;
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

function buildTrainingRows(
  reviews: Review[],
  concepts: Concept[],
  forEval = false
) {
  const byConcept = new Map<string, Concept>();
  for (const c of concepts) byConcept.set(c.id, c);

  const X: number[][] = [];
  const y: number[] = [];
  const outcomes: boolean[] = [];
  const deltaTs: number[] = [];

  for (const r of reviews) {
    const concept = byConcept.get(r.conceptId);
    if (!concept) continue;
    const difficulty = r.difficulty ?? concept.avgDifficulty;
    const features = buildFeatures({
      correctStreak: concept.correctStreak,
      incorrectCount: concept.incorrectCount,
      totalReviews: Math.max(concept.totalReviews, 1),
      avgDaysBetweenReviews:
        concept.avgDaysBetweenReviews || r.daysSinceLastReview,
      daysSinceLastReview: r.daysSinceLastReview,
      conceptEmbeddingSimilarity: 0,
      avgReadTimeMs: r.readTimeMs ?? concept.avgReadTimeMs,
      avgResponseTimeMs: r.responseTimeMs ?? concept.avgResponseTimeMs,
      trapFailRate: r.trapFailed ? 1 : concept.trapFailRate ?? 0,
      avgDifficulty: difficulty,
    });
    X.push(features);
    y.push(
      Math.log(
        observedHalfLife(Math.max(r.daysSinceLastReview, 0.1), r.correct, {
          trapFailed: r.trapFailed,
          difficulty,
        })
      )
    );
    if (forEval) {
      outcomes.push(r.correct);
      deltaTs.push(Math.max(r.daysSinceLastReview, 0.01));
    }
  }

  return { X, y, outcomes, deltaTs };
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
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
