export type MaterialStatus = "processing" | "ready" | "error";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface Material {
  id: string;
  userId: string;
  title: string;
  status: MaterialStatus;
  sourceType: "pdf" | "text";
  storagePath: string | null;
  errorMessage?: string;
  createdAt: string;
}

export interface Chunk {
  id: string;
  materialId: string;
  content: string;
  chunkIndex: number;
  embedding: number[];
}

export interface Concept {
  id: string;
  materialId: string;
  chunkId: string | null;
  title: string;
  definition: string;
  recallProbability: number;
  halfLifeDays: number;
  correctStreak: number;
  incorrectCount: number;
  totalReviews: number;
  avgDaysBetweenReviews: number;
  lastReviewedAt: string | null;
  createdAt: string;
  /** Last learn-phase exposure (EOL judgment) */
  lastLearnedAt?: string | null;
  /** Rolling mean of self-rated difficulty 1–5 (EOL judgment) */
  avgDifficulty?: number;
  learnCount?: number;
  /** Rolling mean encoding time (ms) */
  avgReadTimeMs?: number;
  /** Rolling mean verification latency (ms) */
  avgResponseTimeMs?: number;
  /** Fraction of trap probes the user failed (0–1) */
  trapFailRate?: number;
  trapExposures?: number;
  trapFails?: number;
  /**
   * FSRS-style per-card memory state, evolved online in POST /api/reviews (the
   * source of truth is still the review log — this is a cached current state so
   * the schedule/insights don't have to replay history on every read). Distinct
   * from the population-level HLR half-life above: this is per-card.
   */
  stability?: number;
  fsrsDifficulty?: number;
  fsrsReps?: number;
  fsrsLapses?: number;
}

export interface Card {
  id: string;
  conceptId: string;
  materialId: string;
  front: string;
  back: string;
  createdAt: string;
  /** Optional cloze study mode: `back` with one key span blanked out … */
  clozeText?: string;
  /** … and the span that was removed (the answer to type/recall). */
  clozeAnswer?: string;
}

/** Learn-phase event: dwell time + ease-of-learning judgment (1–5). */
export interface Encoding {
  id: string;
  userId: string;
  cardId: string;
  conceptId: string;
  sessionId: string;
  readTimeMs: number;
  /** 1 = effortless … 5 = very hard to understand */
  difficulty: number;
  encodedAt: string;
}

export interface Review {
  id: string;
  userId: string;
  cardId: string;
  conceptId: string;
  correct: boolean;
  daysSinceLastReview: number;
  sessionId: string;
  reviewedAt: string;
  readTimeMs?: number;
  responseTimeMs?: number;
  probeWasSameMeaning?: boolean;
  userSaidSameMeaning?: boolean;
  trapFailed?: boolean;
  /** Difficulty rated during learn phase for this concept (1–5) */
  difficulty?: number;
}

/** One model's held-out score in the head-to-head comparison. */
export interface ModelScore {
  /** "HLR (trained)" | "Prior (cold-start)" | "SM-2" | "FSRS" */
  name: string;
  logLoss: number;
  brier: number;
  ece: number;
  accuracy: number;
  n: number;
}

/** A reliability-diagram bin, persisted so the UI can draw it without recompute. */
export interface CalibrationBinDTO {
  lower: number;
  upper: number;
  predictedMean: number;
  empiricalRate: number;
  count: number;
}

export interface ModelWeights {
  id: string;
  userId: string;
  weights: number[];
  featureNames: string[];
  trainedOnReviewCount: number;
  heldOutLogLoss: number | null;
  baselineLogLoss: number | null;
  trainedAt: string;
  /** Head-to-head held-out scores: trained HLR vs prior vs SM-2 vs FSRS. */
  comparison?: ModelScore[];
  /** Reliability bins for the trained HLR on the held-out set. */
  calibrationBins?: CalibrationBinDTO[];
  /** FSRS parameters after the light in-app fit (19-vector). */
  fsrsParams?: number[];
}

export interface Database {
  users: User[];
  materials: Material[];
  chunks: Chunk[];
  concepts: Concept[];
  cards: Card[];
  reviews: Review[];
  encodings: Encoding[];
  modelWeights: ModelWeights[];
}

/**
 * HLR features. difficulty comes from ease-of-learning (EOL) judgments —
 * metacognitive ratings that predict later retention (higher = harder = shorter h).
 * Curve: P(recall) = 2^(-Δt / h), h = exp(w·x) — Settles & Meeder (ACL 2016).
 *
 * These describe the *memory trace*, never the elapsed time Δt. Δt is where the
 * curve is sampled, not a property of its shape — feeding it in here would make h
 * a function of when you happen to look, and (because the training target is derived
 * from Δt) would let the model rediscover its own label instead of learning
 * retention. Δt enters only through the likelihood in `fitHalfLifeMLE`.
 */
export const FEATURE_NAMES = [
  "bias",
  "correct_streak",
  "incorrect_count",
  "log_total_reviews",
  "avg_days_between_reviews",
  "concept_embedding_similarity",
  "log_read_time",
  "log_response_time",
  "trap_fail_rate",
  "difficulty",
] as const;

export const PRIOR_WEIGHTS = [
  Math.log(3.0), // bias → ~3 day half-life
  0.35, // correct_streak
  -0.25, // incorrect_count
  0.15, // log_total_reviews
  0.05, // avg_days_between_reviews
  0.1, // concept_embedding_similarity
  0.08, // log_read_time — careful encoding
  -0.18, // log_response_time — slow retrieval ≈ weaker memory
  -0.35, // trap_fail_rate — false recognition
  -0.22, // difficulty (1–5 EOL) — harder slide → shorter half-life
];
