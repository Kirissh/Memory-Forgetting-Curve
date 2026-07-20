import { FEATURE_NAMES, PRIOR_WEIGHTS } from "./types";

export { FEATURE_NAMES, PRIOR_WEIGHTS };

export type FeatureVector = number[];

export interface ConceptFeatures {
  correctStreak: number;
  incorrectCount: number;
  totalReviews: number;
  avgDaysBetweenReviews: number;
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
    c.conceptEmbeddingSimilarity,
    logSeconds(c.avgReadTimeMs, 8),
    logSeconds(c.avgResponseTimeMs, 4),
    Math.min(Math.max(c.trapFailRate ?? 0, 0), 1),
    normalizeDifficulty(c.avgDifficulty),
  ];
}

export interface TrainingRow {
  features: FeatureVector;
  /** Lag between the review and the one before it, in days */
  deltaTDays: number;
  correct: boolean;
}

/** Clamp on w·x, so h stays inside [e^-5, e^8] days and gradients can't blow up. */
const Z_MIN = -5;
const Z_MAX = 8;

/**
 * P(recall) at a lag, given the log-half-life z = w·x.
 * P = 2^(-Δt/h) = exp(-ln2 · Δt · e^-z), i.e. an exponential survival model.
 */
function recallFromZ(z: number, deltaTDays: number): { p: number; lambda: number } {
  const zc = Math.min(Math.max(z, Z_MIN), Z_MAX);
  const lambda = Math.min(
    Math.max(Math.LN2 * deltaTDays * Math.exp(-zc), 1e-9),
    60
  );
  return { p: Math.exp(-lambda), lambda };
}

/**
 * Maximum-likelihood fit of P(recall) = 2^(-Δt/h) with h = exp(w·x).
 *
 * A review is a *Bernoulli outcome*, not an observed probability, so the honest
 * objective is its log-likelihood — not a regression onto a half-life reverse-engineered
 * from the outcome. (That reverse-engineering is what leaks: h_obs = Δt / -log2(p_const)
 * makes the target equal log(Δt) plus a constant, which any model carrying Δt as a
 * feature can invert exactly.) Settles & Meeder can regress on h_obs because they
 * aggregate many trials per lag into a real empirical p; a single binary review
 * carries no such p.
 *
 * Substituting P = exp(-λ), λ = ln2·Δt·e^-z, the per-row gradient collapses to
 *   dLL/dz = λ · [y - (1-y)·P/(1-P)]
 * which is +λ when correct (push h up) and negative when not (push h down).
 *
 * Regularizes toward `prior` rather than 0 — a Gaussian prior centered on the
 * hand-tuned weights, so a user with three reviews degrades to the cold-start model
 * instead of to h = 1 day. Fits in standardized space for conditioning, then returns
 * weights in raw feature space so callers (predictHalfLife, explainWhy) are unchanged.
 */
export function fitHalfLifeMLE(
  rows: TrainingRow[],
  prior: number[],
  opts: { l2?: number; iters?: number; lr?: number } = {}
): number[] {
  // l2 = 1/σ² of the Gaussian prior on w. 30 ⇒ σ ≈ 0.18: a weight only travels far
  // from its prior on real evidence, which matters when weights are O(0.1–0.5) and a
  // deck is ~100 reviews against 10 of them. The penalty is a flat term against a
  // growing likelihood, so it fades on its own as history accumulates.
  const l2 = opts.l2 ?? 30;
  const iters = opts.iters ?? 600;
  const lr = opts.lr ?? 0.05;
  const n = rows.length;
  const d = prior.length;
  if (n === 0) return [...prior];

  // Standardize non-bias columns; a constant column keeps sd 1 and contributes nothing.
  const mean = Array(d).fill(0);
  const sd = Array(d).fill(1);
  for (let j = 1; j < d; j++) {
    let s = 0;
    for (const r of rows) s += r.features[j] ?? 0;
    mean[j] = s / n;
    let v = 0;
    for (const r of rows) v += ((r.features[j] ?? 0) - mean[j]) ** 2;
    const std = Math.sqrt(v / n);
    sd[j] = std > 1e-8 ? std : 1;
  }

  const Z = rows.map((r) => {
    const z = Array(d).fill(0);
    z[0] = 1;
    for (let j = 1; j < d; j++) z[j] = ((r.features[j] ?? 0) - mean[j]) / sd[j];
    return z;
  });

  // Move the prior into standardized space so the penalty pulls toward the same model.
  const priorStd = Array(d).fill(0);
  priorStd[0] = prior[0];
  for (let j = 1; j < d; j++) {
    priorStd[j] = prior[j] * sd[j];
    priorStd[0] += prior[j] * mean[j];
  }

  const w = [...priorStd];
  // Adam — the curvature differs wildly across features even after standardizing.
  const m = Array(d).fill(0);
  const v = Array(d).fill(0);
  const b1 = 0.9;
  const b2 = 0.999;
  const eps = 1e-8;

  for (let t = 1; t <= iters; t++) {
    const grad = Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const { p, lambda } = recallFromZ(z, rows[i].deltaTDays);
      const y = rows[i].correct ? 1 : 0;
      // dLL/dz; guard 1-p as p→1 (short lag) where the wrong-answer term diverges
      const oneMinusP = Math.max(1 - p, 1e-12);
      const dz = lambda * (y - (1 - y) * (p / oneMinusP));
      for (let j = 0; j < d; j++) grad[j] += dz * Z[i][j];
    }
    // Mean log-likelihood gradient, minus the pull toward the prior
    for (let j = 0; j < d; j++) {
      grad[j] = grad[j] / n - (l2 / n) * (w[j] - priorStd[j]);
    }
    for (let j = 0; j < d; j++) {
      m[j] = b1 * m[j] + (1 - b1) * grad[j];
      v[j] = b2 * v[j] + (1 - b2) * grad[j] * grad[j];
      const mh = m[j] / (1 - Math.pow(b1, t));
      const vh = v[j] / (1 - Math.pow(b2, t));
      w[j] += lr * (mh / (Math.sqrt(vh) + eps)); // ascend the likelihood
    }
  }

  // Back to raw feature space: w_raw_j = w_std_j / sd_j, bias absorbs the means.
  const raw = Array(d).fill(0);
  raw[0] = w[0];
  for (let j = 1; j < d; j++) {
    raw[j] = w[j] / sd[j];
    raw[0] -= raw[j] * mean[j];
  }
  return raw.map((x) => (Number.isFinite(x) ? x : 0));
}

/** Mean negative log-likelihood per review — the honest fit metric. */
export function meanNegLogLik(rows: TrainingRow[], weights: number[]): number {
  if (rows.length === 0) return NaN;
  let total = 0;
  for (const r of rows) {
    let z = 0;
    for (let j = 0; j < weights.length; j++) z += weights[j] * (r.features[j] ?? 0);
    const { p } = recallFromZ(z, r.deltaTDays);
    total += logLoss(p, r.correct);
  }
  return total / rows.length;
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

/**
 * Invert P = 2^(-Δt/h) for a recall level: the memory's age when it decays to `p`.
 * At p=0.5 this returns h itself — the half-life *is* the 50%-recall crossing.
 */
export function daysToRecallLevel(halfLifeDays: number, p: number): number {
  const h = Math.max(halfLifeDays, 0.1);
  const clamped = Math.min(Math.max(p, 0.01), 0.99);
  return h * -Math.log2(clamped);
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

/** Look a feature up by name — positions shift when the vector changes. */
export function featureValue(features: number[], name: string): number {
  const i = FEATURE_NAMES.indexOf(name as (typeof FEATURE_NAMES)[number]);
  return i < 0 ? 0 : (features[i] ?? 0);
}

export function explainWhy(
  weights: number[],
  features: number[],
  halfLifeDays: number
): string {
  const top = contributionTerms(weights, features).slice(0, 3);
  const parts = top.map((t) => {
    const v = featureValue(features, t.name);
    if (t.name === "correct_streak" && v > 0) {
      return `your ${v}-hit streak`;
    }
    if (t.name === "incorrect_count" && v > 0) {
      return `${v} miss${v === 1 ? "" : "es"}`;
    }
    if (t.name === "trap_fail_rate" && v > 0) {
      return `trap fails (${(v * 100).toFixed(0)}%)`;
    }
    // Name the factor, don't restate its value — the row already shows the rating.
    if (t.name === "difficulty") return "how hard it felt to learn";
    if (t.name === "log_response_time") return "how fast you answer";
    if (t.name === "log_read_time") return "how long you study it";
    if (t.name === "avg_days_between_reviews") return "your review spacing";
    if (t.name === "log_total_reviews") return "how often you've seen it";
    if (t.name === "concept_embedding_similarity") {
      return "similar topics you know";
    }
    return t.name.replace(/_/g, " ");
  });
  return `Half-life ${halfLifeDays.toFixed(1)} days — mainly ${parts.join(", ")}.`;
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
