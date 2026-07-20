/**
 * Bootstrap uncertainty for the Half-Life Regression estimate.
 *
 * Recall decays as P = 2^(-Δt/h), with the half-life h = exp(w·x) fit by HLR
 * (Settles & Meeder, "A Trainable Spaced Repetition Model for Language Learning",
 * ACL 2016). A single point estimate of w hides how *confident* that fit is: a user
 * with three reviews and a user with three hundred can land on the same h yet deserve
 * very different confidence bands. We quantify that with the nonparametric bootstrap —
 * resample the reviews with replacement, refit, and read the spread of the resulting
 * curves. Few reviews ⇒ resamples disagree ⇒ a WIDE band; lots of reviews ⇒ they agree
 * ⇒ a tight one, which is exactly what the forgetting-curve UI wants to draw.
 *
 * This module is deliberately decoupled from the fitter: the caller injects `fit` and
 * `predict`, so it never imports the HLR internals and stays pure and testable. It is
 * fully deterministic — a seeded LCG drives resampling, and no clock is read.
 */

export interface BootstrapRow {
  features: number[];
  deltaTDays: number;
  correct: boolean;
}

export interface HalfLifeInterval {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  std: number;
}

/** Refit weights from a (resampled) set of rows, regularized toward `prior`. */
export type Fitter = (rows: BootstrapRow[], prior: number[]) => number[];

/** Map fitted weights + a feature vector to a half-life in days (h = exp(w·x)). */
export type Predictor = (weights: number[], features: number[]) => number;

/**
 * Seeded linear congruential generator (Numerical Recipes constants over m = 2^32).
 * We roll our own instead of Math.random so the bands reproduce exactly across runs
 * and machines — a resample driven by an unseeded RNG would make the UI flicker.
 * `a*state` peaks near 7.15e15 < 2^53, so the multiply stays exact in doubles.
 */
function makeLcg(seed: number): () => number {
  // Normalize any seed (negative, fractional, huge) into a valid uint32 state.
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0; // >>> 0 applies mod 2^32
    return state / 4294967296; // → [0, 1)
  };
}

/**
 * Draw `B` bootstrap resamples of `rows` WITH REPLACEMENT and refit each, returning the
 * B weight vectors. Deterministic given (rows, prior, fit, seed): same inputs ⇒ same
 * output every time.
 *
 * B stays modest (default 40) on purpose — this runs once per user and the resulting
 * samples are reused across every concept the user has, so a big B buys little and costs
 * a full refit each. With no rows there is nothing to resample, so we hand back the prior
 * once: the caller then gets a degenerate (zero-width) band anchored on the cold-start model.
 */
export function bootstrapWeights(
  rows: BootstrapRow[],
  prior: number[],
  fit: Fitter,
  opts: { B?: number; seed?: number } = {}
): number[][] {
  const B = Math.max(1, Math.floor(opts.B ?? 40));
  const seed = opts.seed ?? 12345;

  // No evidence to resample — the only defensible "sample" is the prior itself.
  // Copy it so callers can't mutate our input through the returned array.
  if (rows.length === 0) return [[...prior]];

  const rng = makeLcg(seed);
  const n = rows.length;
  const samples: number[][] = [];

  for (let b = 0; b < B; b++) {
    const resample: BootstrapRow[] = new Array(n);
    for (let i = 0; i < n; i++) {
      // Clamp guards the (vanishingly unlikely) rng()===1 boundary against idx === n.
      const idx = Math.min(n - 1, Math.floor(rng() * n));
      resample[i] = rows[idx];
    }
    samples.push(fit(resample, prior));
  }

  return samples;
}

/**
 * p-quantile (p in [0,1]) by linear interpolation between order statistics.
 * Sorts a COPY so the caller's array is never reordered underneath it.
 */
function percentile(values: number[], p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(Math.max(p, 0), 1) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Summarize a sample into p10/p50/p90, mean and std. Std is the population form
 * (÷n): these ARE the full set of bootstrap draws we hold, not a sub-sample of them,
 * so there is no (n-1) bias correction to make. Guards an empty sample (everything
 * upstream filtered out) into a flat zero band rather than propagating NaN into the UI.
 */
function summarize(values: number[]): HalfLifeInterval {
  const n = values.length;
  if (n === 0) return { p10: 0, p50: 0, p90: 0, mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    p10: percentile(values, 0.1),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    mean,
    std: Math.sqrt(Math.max(variance, 0)), // max() kills any -0/rounding under the root
  };
}

/**
 * Half-life confidence interval at a feature vector: predict h for every bootstrap
 * weight sample, then summarize the spread. Non-finite predictions are dropped so one
 * bad refit can't poison the whole band.
 */
export function halfLifeInterval(
  weightSamples: number[][],
  features: number[],
  predict: Predictor
): HalfLifeInterval {
  const halfLives = weightSamples
    .map((w) => predict(w, features))
    .filter((h) => Number.isFinite(h));
  return summarize(halfLives);
}

/**
 * Recall confidence interval at a given age: for each bootstrap sample map its
 * half-life to P = 2^(-daysSinceAnchor / max(h, 0.1)) — the same forgetting curve the
 * app draws — and summarize the RECALL distribution directly.
 *
 * We deliberately do NOT invert the half-life interval. Recall is a *decreasing*
 * function of h, so p10-of-recall lines up with p90-of-h; percentiling the recall
 * samples straight avoids that flip and stays correct even though the h→recall map is
 * nonlinear (mean of recall ≠ recall of mean-h).
 */
export function recallIntervalAt(
  weightSamples: number[][],
  features: number[],
  predict: Predictor,
  daysSinceAnchor: number
): HalfLifeInterval {
  const t = Math.max(daysSinceAnchor, 0); // negative age is meaningless → treat as "now"
  const recalls = weightSamples
    .map((w) => predict(w, features))
    .filter((h) => Number.isFinite(h))
    // max(h, 0.1) mirrors predictRecall's floor so we never divide by ~0.
    .map((h) => Math.pow(2, -t / Math.max(h, 0.1)));
  return summarize(recalls);
}
