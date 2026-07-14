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
}

export interface Card {
  id: string;
  conceptId: string;
  materialId: string;
  front: string;
  back: string;
  createdAt: string;
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

export interface ModelWeights {
  id: string;
  userId: string;
  weights: number[];
  featureNames: string[];
  trainedOnReviewCount: number;
  heldOutLogLoss: number | null;
  baselineLogLoss: number | null;
  trainedAt: string;
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
 */
export const FEATURE_NAMES = [
  "bias",
  "correct_streak",
  "incorrect_count",
  "log_total_reviews",
  "avg_days_between_reviews",
  "days_since_last_review",
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
  -0.02, // days_since_last_review
  0.1, // concept_embedding_similarity
  0.08, // log_read_time — careful encoding
  -0.18, // log_response_time — slow retrieval ≈ weaker memory
  -0.35, // trap_fail_rate — false recognition
  -0.22, // difficulty (1–5 EOL) — harder slide → shorter half-life
];
