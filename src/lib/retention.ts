import { FEATURE_NAMES, PRIOR_WEIGHTS } from "./types";

export { FEATURE_NAMES, PRIOR_WEIGHTS };

export type FeatureVector = number[];

export interface ConceptFeatures {
  correctStreak: number;
  incorrectCount: number;
  totalReviews: number;
  avgDaysBetweenReviews: number;
  daysSinceLastReview: number;
  conceptEmbeddingSimilarity: number;
  avgReadTimeMs?: number;
  avgResponseTimeMs?: number;
  trapFailRate?: number;
  /** Ease-of-learning judgment, 1–5 */
  avgDifficulty?: number;
}

function logSeconds(ms: number | undefined, fallbackSec: number): number {
  const sec = ms && ms > 0 ? ms / 1000 : fallbackSec;
  return Math.log1p(Math.min(Math.max(sec, 0.05), 120));
}

/** Map 1–5 difficulty onto [0,1] centered at medium (3). */
export function normalizeDifficulty(d: number | undefined): number {
  if (d == null || !Number.isFinite(d)) return 0.5; // unknown → mid prior feature
  return (Math.min(5, Math.max(1, d)) - 1) / 4;
}

export function buildFeatures(c: ConceptFeatures): FeatureVector {
  return [
    1.0,
    c.correctStreak,
    c.incorrectCount,
    Math.log1p(c.totalReviews),
    c.avgDaysBetweenReviews,
    c.daysSinceLastReview,
    c.conceptEmbeddingSimilarity,
    logSeconds(c.avgReadTimeMs, 8),
    logSeconds(c.avgResponseTimeMs, 4),
    Math.min(Math.max(c.trapFailRate ?? 0, 0), 1),
    normalizeDifficulty(c.avgDifficulty),
  ];
}

/**
 * Invert P = 2^(-Δt/h). Trap fails → stronger forgetting evidence.
 * Settles & Meeder HLR uses this power-of-two form of exponential decay.
 */
export function observedHalfLife(
  deltaTDays: number,
  wasCorrect: boolean,
  opts?: { trapFailed?: boolean; difficulty?: number }
): number {
  let p = wasCorrect ? 0.95 : 0.05;
  if (opts?.trapFailed) p = 0.02;
  // Hard EOL ratings slightly lower the implied residual when wrong
  if (!wasCorrect && opts?.difficulty && opts.difficulty >= 4) p = Math.min(p, 0.03);
  const h = deltaTDays / -Math.log2(p);
  return Math.max(h, 0.5);
}

export function fitRidge(X: number[][], y: number[], lambda = 1.0): number[] {
  const nFeatures = X[0].length;
  const XtX: number[][] = Array.from({ length: nFeatures }, () =>
    Array(nFeatures).fill(0)
  );
  const Xty: number[] = Array(nFeatures).fill(0);

  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < nFeatures; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < nFeatures; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  for (let j = 0; j < nFeatures; j++) {
    XtX[j][j] += lambda;
  }

  return solveLinearSystem(XtX, Xty);
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const div = M[col][col] || 1e-12;
    for (let j = col; j <= n; j++) M[col][j] /= div;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row[n]);
}

export function alignWeights(weights: number[] | undefined): number[] {
  if (!weights || weights.length !== PRIOR_WEIGHTS.length) {
    return [...PRIOR_WEIGHTS];
  }
  return weights;
}

export function predictHalfLife(weights: number[], features: number[]): number {
  const w = alignWeights(weights);
  const dot = w.reduce((sum, wi, i) => sum + wi * (features[i] ?? 0), 0);
  return Math.exp(Math.min(Math.max(dot, -5), 8));
}

/** Ebbinghaus / HLR: P(recall) = 2^(-Δt / h) */
export function predictRecall(halfLifeDays: number, daysSinceReview: number): number {
  if (daysSinceReview <= 0) return 1;
  const h = Math.max(halfLifeDays, 0.1);
  return Math.pow(2, -daysSinceReview / h);
}

export function contributionTerms(
  weights: number[],
  features: number[]
): { name: string; value: number }[] {
  const w = alignWeights(weights);
  return FEATURE_NAMES.map((name, i) => ({
    name,
    value: w[i] * features[i],
  }))
    .filter((t) => t.name !== "bias")
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export function explainWhy(
  weights: number[],
  features: number[],
  halfLifeDays: number
): string {
  const top = contributionTerms(weights, features).slice(0, 3);
  const parts = top.map((t) => {
    if (t.name === "correct_streak" && features[1] > 0) {
      return `your ${features[1]}-hit streak`;
    }
    if (t.name === "incorrect_count" && features[2] > 0) {
      return `${features[2]} miss${features[2] === 1 ? "" : "es"}`;
    }
    if (t.name === "trap_fail_rate" && features[9] > 0) {
      return `trap fails (${(features[9] * 100).toFixed(0)}%)`;
    }
    if (t.name === "difficulty") {
      const stars = Math.round(features[10] * 4) + 1;
      return `EOL difficulty ~${stars}/5`;
    }
    if (t.name === "log_response_time") return "retrieval speed";
    if (t.name === "log_read_time") return "encoding time";
    if (t.name === "days_since_last_review") return "time since last touch";
    return t.name.replace(/_/g, " ");
  });
  return `h=${halfLifeDays.toFixed(1)}d — mainly ${parts.join(", ")}.`;
}

export function logLoss(p: number, correct: boolean): number {
  const eps = 1e-6;
  const clamped = Math.min(Math.max(p, eps), 1 - eps);
  return correct ? -Math.log(clamped) : -Math.log(1 - clamped);
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(ms / (1000 * 60 * 60 * 24), 0);
}

/** Reference timestamp for Δt — last test, else last learn, else creation. */
export function memoryAnchor(concept: {
  lastReviewedAt: string | null;
  lastLearnedAt?: string | null;
  createdAt: string;
}): string {
  return concept.lastReviewedAt || concept.lastLearnedAt || concept.createdAt;
}
