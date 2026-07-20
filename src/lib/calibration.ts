/**
 * Calibration + proper-scoring metrics for probabilistic binary predictions.
 *
 * Recall's models emit P(recall) ∈ [0,1] per review. To trust those numbers we
 * must show they are *calibrated*: of all reviews predicted at ~70%, ~70% are
 * actually recalled. We measure this with reliability-diagram bins plus scalar
 * summaries: ECE / MCE (calibration error) and two strictly proper scoring
 * rules — Brier score and log loss — that jointly reward calibration AND
 * sharpness, so they double as a model-vs-model comparison.
 *
 * Refs: Brier (1950); Naeini et al., "Obtaining Well Calibrated Probabilities"
 * (AAAI 2015) for ECE/MCE. Pure & deterministic: no I/O, no clock, no deps.
 */

/** Probabilities are clamped away from {0,1} so ln(p)/ln(1-p) stay finite. */
const EPS = 1e-6;

/** Clamp a probability into [EPS, 1-EPS] to guard log(0) and NaN inputs. */
function clampP(p: number): number {
  // Number.isFinite guards against NaN/Infinity slipping through into logs.
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - EPS, Math.max(EPS, p));
}

export interface CalibrationBin {
  /** Inclusive lower edge of the probability bin. */
  lower: number;
  /** Exclusive upper edge (inclusive for the final bin). */
  upper: number;
  /** Mean predicted probability of the members of this bin. */
  predictedMean: number;
  /** Observed fraction of members that were actually correct. */
  empiricalRate: number;
  /** Number of predictions that fell in this bin. */
  count: number;
}

export interface CalibrationReport {
  /** Non-empty bins only, ordered by increasing probability. */
  bins: CalibrationBin[];
  /** Expected Calibration Error: count-weighted mean gap over bins. */
  ece: number;
  /** Maximum Calibration Error: worst single-bin gap. */
  mce: number;
  /** Brier score: mean squared error of the probabilities. */
  brier: number;
  /** Log loss (binary cross-entropy) of the probabilities. */
  logLoss: number;
  /** Number of predictions scored. */
  n: number;
  /** Overall fraction correct (the constant-predictor baseline). */
  baseRate: number;
  /** Fraction where a 0.5 threshold decision matched the outcome. */
  accuracy: number;
}

/**
 * Log loss = mean of -(y·ln p + (1-y)·ln(1-p)), lower is better.
 * Probabilities are clamped so a confident miss costs a large-but-finite -ln(EPS).
 */
export function logLoss(preds: { p: number; correct: boolean }[]): number {
  const n = preds.length;
  if (n === 0) return 0; // nothing to score → 0, never NaN
  let sum = 0;
  for (const { p, correct } of preds) {
    const cp = clampP(p);
    // Only the term for the realized outcome contributes; the other has y=0.
    sum += correct ? -Math.log(cp) : -Math.log(1 - cp);
  }
  return sum / n;
}

/**
 * Brier score = mean((p - y)^2), lower is better. A strictly proper score that
 * decomposes into calibration + refinement, so it penalizes miscalibration.
 */
export function brierScore(preds: { p: number; correct: boolean }[]): number {
  const n = preds.length;
  if (n === 0) return 0;
  let sum = 0;
  for (const { p, correct } of preds) {
    // No log here, so clamp only to neutralize NaN/Infinity, not for log-safety.
    const cp = clampP(p);
    const y = correct ? 1 : 0;
    const d = cp - y;
    sum += d * d;
  }
  return sum / n;
}

/**
 * Build a full calibration report: reliability bins + ECE/MCE + Brier + log loss
 * + baseline stats. `nBins` equal-width bins tile [0,1]; a prediction with
 * probability p lands in bin floor(p·nBins), clamped so p=1 joins the last bin.
 * Empty bins are dropped from `bins` but never distort n / weights / maxima.
 */
export function calibration(
  preds: { p: number; correct: boolean }[],
  nBins = 10,
): CalibrationReport {
  const n = preds.length;
  // Guard against nonsense bin counts before using them as array sizes/divisors.
  const k = Number.isFinite(nBins) && nBins >= 1 ? Math.floor(nBins) : 10;

  if (n === 0) {
    return {
      bins: [],
      ece: 0,
      mce: 0,
      brier: 0,
      logLoss: 0,
      n: 0,
      baseRate: 0,
      accuracy: 0,
    };
  }

  // Per-bin accumulators; index i covers [i/k, (i+1)/k).
  const pSum = new Array<number>(k).fill(0);
  const correctSum = new Array<number>(k).fill(0);
  const count = new Array<number>(k).fill(0);

  let totalCorrect = 0;
  let accCorrect = 0;

  for (const { p, correct } of preds) {
    const cp = clampP(p);
    const y = correct ? 1 : 0;

    // floor(cp·k) can equal k when cp≈1; clamp so it lands in the final bin.
    const idx = Math.min(k - 1, Math.max(0, Math.floor(cp * k)));
    pSum[idx] += cp;
    correctSum[idx] += y;
    count[idx] += 1;

    totalCorrect += y;
    // 0.5-threshold decision: p>=0.5 predicts "recall"; does it match reality?
    if ((cp >= 0.5) === correct) accCorrect += 1;
  }

  const bins: CalibrationBin[] = [];
  let ece = 0;
  let mce = 0;

  for (let i = 0; i < k; i++) {
    const c = count[i];
    if (c === 0) continue; // drop empties, but they contributed nothing anyway
    const predictedMean = pSum[i] / c;
    const empiricalRate = correctSum[i] / c;
    const gap = Math.abs(empiricalRate - predictedMean);

    ece += (c / n) * gap; // count-weighted so big bins matter more
    if (gap > mce) mce = gap;

    bins.push({
      lower: i / k,
      upper: (i + 1) / k,
      predictedMean,
      empiricalRate,
      count: c,
    });
  }

  return {
    bins,
    ece,
    mce,
    brier: brierScore(preds),
    logLoss: logLoss(preds),
    n,
    baseRate: totalCorrect / n,
    accuracy: accCorrect / n,
  };
}
