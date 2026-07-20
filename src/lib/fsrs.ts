/**
 * FSRS-inspired per-card memory model (stability S in days, difficulty D in 1–10).
 *
 * Unlike the app's population-level HLR, every card carries its own {S, D} that
 * evolves from each review's GRADE and its elapsed RETRIEVABILITY — so a hard-won
 * recall after a long gap (low R) grows stability more than an easy recent one.
 * That coupling is the spacing effect, and it's why per-card FSRS beats a fixed h.
 *
 * Retrievability is the FSRS power-forgetting curve R(t,S) = (1 + FACTOR·t/S)^DECAY
 * with DECAY = -0.5 and FACTOR = 19/81, calibrated so R = 0.9 exactly at t = S. The
 * stability and difficulty updates follow the open-source FSRS-4.5 / FSRS-5 formulas.
 *
 * Model & default weights: github.com/open-spaced-repetition (FSRS-5). The short-term
 * / same-day params w[17], w[18] are unused here — this module scores day-scale
 * reviews only. Pure and deterministic: no Date.now(), no I/O; "now" enters solely as
 * the elapsed-days argument, so replays and fits are reproducible and testable.
 */

export type FsrsGrade = 1 | 2 | 3 | 4; // 1=Again(lapse) 2=Hard 3=Good 4=Easy

export interface FsrsReview {
  grade: FsrsGrade;
  /** Days elapsed since the previous review of this card (>= 0). */
  deltaTDays: number;
}

export interface FsrsState {
  stability: number; // days until recall decays to 0.9
  difficulty: number; // 1 (easy) .. 10 (hard)
}

export type FsrsParams = number[]; // length 19

// FSRS-5 default weights. Do not reorder — every formula below indexes by position.
export const DEFAULT_FSRS_PARAMS: FsrsParams = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

export const FSRS_DECAY = -0.5;
export const FSRS_FACTOR = 19 / 81;

// Bounds shared across the model. Stability lives in [0.01, 36500] days (~100y);
// difficulty in [1, 10]. Clamping everywhere is what keeps NaN/Infinity from escaping.
const S_MIN = 0.01;
const S_MAX = 36500;
const D_MIN = 1;
const D_MAX = 10;

/** Clamp that also swallows NaN/Infinity (returns the low bound) so no bad value leaks. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(Math.max(x, lo), hi);
}

/**
 * FSRS power-forgetting curve: R(t,S) = (1 + FACTOR·t/S)^DECAY.
 * With DECAY = -0.5 and FACTOR = 19/81 this yields R = 0.9 at t = S. The base is
 * always >= 1 (t, factor, s >= 0), so the fractional power stays real; result in (0,1].
 */
export function retrievability(
  stability: number,
  tDays: number,
  decay: number = FSRS_DECAY,
  factor: number = FSRS_FACTOR
): number {
  const t = Math.max(tDays, 0); // elapsed time can't run backwards
  const s = Math.max(stability, S_MIN); // guard divide-by-zero
  const base = 1 + (factor * t) / s;
  return clamp(Math.pow(base, decay), 0, 1);
}

/** Initial stability from the very first grade — the grade *is* the seed for S. */
export function initStability(grade: FsrsGrade, w: FsrsParams): number {
  return clamp(w[grade - 1], S_MIN, S_MAX);
}

/** Initial difficulty: harder-felt first grades (low G) start more difficult. */
export function initDifficulty(grade: FsrsGrade, w: FsrsParams): number {
  return clamp(w[4] - Math.exp(w[5] * (grade - 1)) + 1, D_MIN, D_MAX);
}

/**
 * Evolve {S, D} through one review at elapsed time `tDays`, given its `grade`.
 *
 * Difficulty: a linear-damped nudge by the grade error (G-3), then mean-reverted
 * toward the "Easy" initial difficulty D0(4). (FSRS-4.5/5 convention — the target of
 * the reversion is the grade-4 init difficulty, not a separate constant.)
 *
 * Stability: on success it grows multiplicatively, and the exp(w[10]·(1-R))-1 term is
 * the spacing effect — a low R at recall (long gap, nearly forgotten) grows S more
 * than an easy, recent hit. On a lapse it collapses to the post-forgetting stability
 * and is capped so forgetting can never *raise* stability.
 */
export function nextState(
  state: FsrsState,
  grade: FsrsGrade,
  tDays: number,
  w: FsrsParams = DEFAULT_FSRS_PARAMS
): FsrsState {
  const R = retrievability(state.stability, tDays);

  const dampedDelta = -w[6] * (grade - 3);
  const D1 = state.difficulty + (dampedDelta * (10 - state.difficulty)) / 9;
  const Dnew = clamp(w[7] * initDifficulty(4, w) + (1 - w[7]) * D1, D_MIN, D_MAX);

  let Snew: number;
  if (grade === 1) {
    // Lapse ("forget" stability). Grows with the retrievability shortfall (1-R),
    // shrinks with difficulty and prior stability.
    Snew =
      w[11] *
      Math.pow(Dnew, -w[12]) *
      (Math.pow(state.stability + 1, w[13]) - 1) *
      Math.exp(w[14] * (1 - R));
    // A lapse must never increase stability — cap at the pre-lapse value.
    Snew = Math.min(Snew, state.stability);
  } else {
    // Successful recall. hard (G=2) dampens the increment, easy (G=4) boosts it.
    const hard = grade === 2 ? w[15] : 1;
    const easy = grade === 4 ? w[16] : 1;
    Snew =
      state.stability *
      (1 +
        Math.exp(w[8]) *
          (11 - Dnew) *
          Math.pow(state.stability, -w[9]) *
          (Math.exp(w[10] * (1 - R)) - 1) *
          hard *
          easy);
  }

  return { stability: clamp(Snew, S_MIN, S_MAX), difficulty: Dnew };
}

export interface FsrsPrediction {
  deltaTDays: number;
  grade: FsrsGrade;
  /** Not a lapse: grade > 1. */
  correct: boolean;
  predictedRecall: number;
  /** The state the prediction was made FROM (pre-update), so
   *  predictedRecall === retrievability(state.stability, deltaTDays) always holds. */
  state: FsrsState;
  /** True for a trail's first review — excluded from fair scoring. */
  isFirst: boolean;
}

/**
 * Replay a card's review history, predicting each review's recall from the state
 * carried in from the review before it (predict BEFORE updating).
 *
 * The first grade merely *seeds* {S, D} (FSRS applies no update to the very first
 * rating), so its prediction is flagged isFirst and dropped from fair scoring — the
 * model never earned it from prior evidence. Every later review predicts, then evolves.
 */
export function replayFsrs(
  reviews: FsrsReview[],
  w: FsrsParams = DEFAULT_FSRS_PARAMS
): FsrsPrediction[] {
  const out: FsrsPrediction[] = [];
  if (reviews.length === 0) return out;

  const first = reviews[0];
  let state: FsrsState = {
    stability: initStability(first.grade, w),
    difficulty: initDifficulty(first.grade, w),
  };
  out.push({
    deltaTDays: first.deltaTDays,
    grade: first.grade,
    correct: first.grade > 1,
    predictedRecall: retrievability(state.stability, first.deltaTDays),
    state: { ...state }, // copy: stored states must not alias the evolving one
    isFirst: true,
  });

  for (let i = 1; i < reviews.length; i++) {
    const r = reviews[i];
    // Predict from the carried-in (previous) state, THEN update — no peeking ahead.
    out.push({
      deltaTDays: r.deltaTDays,
      grade: r.grade,
      correct: r.grade > 1,
      predictedRecall: retrievability(state.stability, r.deltaTDays),
      state: { ...state },
      isFirst: false,
    });
    state = nextState(state, r.grade, r.deltaTDays, w);
  }

  return out;
}

/**
 * Flatten many cards' replays into scorable {p, correct} pairs. `skipFirst` (default
 * true) drops each trail's seed review, which the model didn't predict from evidence.
 */
export function fsrsPooledPredictions(
  trails: FsrsReview[][],
  w: FsrsParams = DEFAULT_FSRS_PARAMS,
  opts: { skipFirst?: boolean } = {}
): { p: number; correct: boolean }[] {
  const skipFirst = opts.skipFirst ?? true;
  const out: { p: number; correct: boolean }[] = [];
  for (const trail of trails) {
    for (const pr of replayFsrs(trail, w)) {
      if (skipFirst && pr.isFirst) continue;
      out.push({ p: pr.predictedRecall, correct: pr.correct });
    }
  }
  return out;
}

/** Binary log-loss with eps clamping — the honest fit objective for a Bernoulli recall. */
function fsrsLogLoss(p: number, correct: boolean): number {
  const eps = 1e-6;
  const c = clamp(p, eps, 1 - eps);
  return correct ? -Math.log(c) : -Math.log(1 - c);
}

/** Mean pooled log-loss over all scorable reviews; Infinity when there is nothing to score. */
function pooledLogLoss(trails: FsrsReview[][], w: FsrsParams): number {
  const preds = fsrsPooledPredictions(trails, w, { skipFirst: true });
  if (preds.length === 0) return Infinity;
  let total = 0;
  for (const { p, correct } of preds) total += fsrsLogLoss(p, correct);
  const mean = total / preds.length;
  return Number.isFinite(mean) ? mean : Infinity;
}

// Only the four initial stabilities and the stability-growth term are fit. The rest of
// FSRS's 19 params need far more data than a light in-app fit can responsibly move.
const FIT_SPEC: { idx: number; lo: number; hi: number; step: number }[] = [
  { idx: 0, lo: 0.01, hi: 30, step: 0.3 }, // init S: Again
  { idx: 1, lo: 0.01, hi: 40, step: 0.5 }, // init S: Hard
  { idx: 2, lo: 0.1, hi: 100, step: 1.0 }, // init S: Good
  { idx: 3, lo: 0.1, hi: 300, step: 2.0 }, // init S: Easy
  { idx: 8, lo: -1, hi: 5, step: 0.2 }, // log stability-growth term
];

/**
 * Light coordinate-descent fit of the tunable subset (four init stabilities + w[8])
 * to minimize pooled log-loss. Each stalled sweep halves the step sizes and tries one
 * jittered restart to escape a shallow local minimum.
 *
 * DETERMINISTIC by construction: the jitter comes from a fixed-seed LCG, never
 * Math.random, so a given review history always fits to the same params. Returns `base`
 * unchanged if it cannot beat the starting loss, and never emits NaN.
 * Cost is O(iters · total_reviews) — a constant number of scored replays per iteration.
 */
export function fitFsrs(
  trails: FsrsReview[][],
  base: FsrsParams = DEFAULT_FSRS_PARAMS,
  opts: { iters?: number } = {}
): FsrsParams {
  const iters = Math.max(1, Math.floor(opts.iters ?? 60));
  const baseW = base.slice();
  const baseLoss = pooledLogLoss(trails, baseW);
  if (!Number.isFinite(baseLoss)) return baseW; // nothing scorable → leave base as-is

  const best = baseW.slice();
  let bestLoss = baseLoss;
  const steps = FIT_SPEC.map((s) => s.step);

  // Fixed-seed LCG (Numerical Recipes constants). Deterministic pseudo-randomness only.
  let seed = 0x9e3779b1 >>> 0;
  const nextRand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000; // [0, 1)
  };

  for (let it = 0; it < iters; it++) {
    let improved = false;

    // One sweep: probe +/- step on each tunable coordinate, keep any improvement.
    for (let k = 0; k < FIT_SPEC.length; k++) {
      const spec = FIT_SPEC[k];
      for (const dir of [1, -1] as const) {
        const cand = best.slice();
        cand[spec.idx] = clamp(best[spec.idx] + dir * steps[k], spec.lo, spec.hi);
        if (cand[spec.idx] === best[spec.idx]) continue; // pinned at a bound
        const loss = pooledLogLoss(trails, cand);
        if (loss < bestLoss - 1e-9) {
          bestLoss = loss;
          best[spec.idx] = cand[spec.idx];
          improved = true;
        }
      }
    }

    if (!improved) {
      // Stalled: refine the grid, and try one LCG-jittered restart around `best`.
      for (let k = 0; k < steps.length; k++) steps[k] *= 0.5;

      const cand = best.slice();
      for (let k = 0; k < FIT_SPEC.length; k++) {
        const spec = FIT_SPEC[k];
        const jitter = (spec.hi - spec.lo) * 0.05 * (nextRand() - 0.5) * 2;
        cand[spec.idx] = clamp(best[spec.idx] + jitter, spec.lo, spec.hi);
      }
      const loss = pooledLogLoss(trails, cand);
      if (loss < bestLoss - 1e-9) {
        bestLoss = loss;
        for (const spec of FIT_SPEC) best[spec.idx] = cand[spec.idx];
      }

      // Steps have decayed below any useful resolution — no further gains possible.
      if (steps.every((s) => s < 1e-4)) break;
    }
  }

  if (!(bestLoss < baseLoss - 1e-9)) return baseW; // couldn't improve → base unchanged
  return best.map((x) => (Number.isFinite(x) ? x : 0));
}
