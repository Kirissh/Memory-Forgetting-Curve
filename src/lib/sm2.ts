/**
 * SM-2 (SuperMemo 2) baseline — a fixed, hand-designed scheduler we score against
 * the app's trained Half-Life Regression model.
 *
 * SM-2 (Woźniak, 1990) tracks three per-item variables: an ease factor EF
 * (≥ 1.3), a repetition count n, and an interval I in days. A pass grows I
 * geometrically (1 → 6 → I·EF); a lapse resets it to 1. SM-2 has no notion of
 * recall probability — its interval is *designed* to land at roughly 90%
 * retention, so we invert that design assumption to turn an interval into a
 * half-life: solving 2^(-I/h) = target gives h = I / (-log2(target)). Feeding
 * that h into the same forgetting curve the rest of the app uses,
 * P(recall) = 2^(-Δt/h) (Ebbinghaus; Settles & Meeder, ACL 2016), lets SM-2
 * emit a comparable per-review probability for log-loss / calibration.
 *
 * Pure and deterministic: no clock, no I/O. Predictions are always made from the
 * state *before* the review's outcome is applied, so scoring stays honest.
 */

export interface Sm2Review {
  correct: boolean;
  deltaTDays: number;
}

export interface Sm2Prediction {
  deltaTDays: number;
  correct: boolean;
  predictedRecall: number;
  intervalDays: number;
  easeFactor: number;
  isFirst: boolean;
}

/** SM-2 intervals are tuned to hold recall near this level at the interval's end. */
export const SM2_TARGET_RETENTION = 0.9;

// SM-2 constants.
const EF_START = 2.5;
const EF_FLOOR = 1.3;
// Binary outcomes lack SM-2's 0–5 self-grade granularity, so we collapse them to a
// single passing / failing grade: correct → 4 (a solid pass), incorrect → 2 (a
// failing grade < 3, which triggers a lapse). The exact values only affect the EF
// drift, and 4/2 keep a clean pass on correct while a miss meaningfully lowers EF.
const PASS_QUALITY = 4;
const FAIL_QUALITY = 2;

// Numeric guards so a half-life or probability can never become NaN/Infinity.
const MIN_INTERVAL_DAYS = 0.1;
const PROB_EPS = 1e-6;
// The first review of a trail has no established interval; SM-2 would schedule 1 day
// after a first pass, so we predict as if the current interval were 1 day.
const DEFAULT_FIRST_INTERVAL_DAYS = 1;

/** Keep a probability strictly inside (0,1) so downstream log-loss never sees log(0). */
function clampProb(p: number): number {
  return Math.min(Math.max(p, PROB_EPS), 1 - PROB_EPS);
}

/**
 * Convert an SM-2 interval into a half-life by inverting its design target:
 * SM-2 aims for `target` retention at the interval, so 2^(-I/h) = target and
 * h = I / (-log2(target)).
 */
export function impliedHalfLife(
  intervalDays: number,
  target: number = SM2_TARGET_RETENTION
): number {
  const I = Math.max(intervalDays, MIN_INTERVAL_DAYS);
  // Clamp target into (0,1): at target→1, -log2(target)→0 (divide-by-zero, h→∞);
  // at target→0, -log2(target)→∞. Either extreme would poison the half-life.
  const t = Math.min(Math.max(target, PROB_EPS), 1 - PROB_EPS);
  const denom = -Math.log2(t); // strictly > 0 for t in (0,1)
  return I / denom;
}

/**
 * Replay a concept's chronological reviews through SM-2, emitting one prediction
 * per review made from the state *before* that review's outcome is applied.
 */
export function replaySm2(reviews: Sm2Review[]): Sm2Prediction[] {
  let easeFactor = EF_START;
  let repetitions = 0; // n
  let interval = DEFAULT_FIRST_INTERVAL_DAYS; // established interval; unused until a review sets it
  let established = false; // no prior scheduling yet

  const predictions: Sm2Prediction[] = [];

  for (const review of reviews) {
    const isFirst = !established;
    // No prior interval on the first review → fall back to the 1-day default.
    const predInterval = Math.max(
      isFirst ? DEFAULT_FIRST_INTERVAL_DAYS : interval,
      MIN_INTERVAL_DAYS
    );
    const h = impliedHalfLife(predInterval);
    // Clamp Δt ≥ 0 (chronological data should never go backward) so recall ≤ 1.
    const delta = Math.max(review.deltaTDays, 0);
    const predictedRecall = clampProb(Math.pow(2, -delta / h));

    // Record the state that produced this prediction (pre-update EF and interval).
    predictions.push({
      deltaTDays: review.deltaTDays,
      correct: review.correct,
      predictedRecall,
      intervalDays: predInterval,
      easeFactor,
      isFirst,
    });

    // Apply the outcome → advance SM-2 state for the next review's prediction.
    const q = review.correct ? PASS_QUALITY : FAIL_QUALITY;
    if (q >= 3) {
      // Schedule the next interval before touching EF, per canonical SM-2, so the
      // geometric step uses the ease factor that was in force for this review.
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      repetitions += 1;
    } else {
      // A lapse restarts the schedule from the beginning.
      repetitions = 0;
      interval = 1;
    }
    interval = Math.max(interval, MIN_INTERVAL_DAYS);

    // EF drift: correct (q=4) leaves EF unchanged, a lapse (q=2) drops it ~0.32,
    // floored at 1.3 so intervals can't collapse toward zero.
    easeFactor = Math.max(
      EF_FLOOR,
      easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    );

    established = true;
  }

  return predictions;
}

/**
 * Replay many concept trails and flatten to {p, correct} pairs for pooled scoring.
 * `skipFirst` (default true) drops each trail's first review: with no prior state
 * its prediction leans on the 1-day default, which is unfair to grade against HLR.
 */
export function sm2PooledPredictions(
  trails: Sm2Review[][],
  opts: { skipFirst?: boolean } = {}
): { p: number; correct: boolean }[] {
  const skipFirst = opts.skipFirst ?? true;
  const pooled: { p: number; correct: boolean }[] = [];

  for (const trail of trails) {
    for (const pred of replaySm2(trail)) {
      if (skipFirst && pred.isFirst) continue;
      pooled.push({ p: pred.predictedRecall, correct: pred.correct });
    }
  }

  return pooled;
}
