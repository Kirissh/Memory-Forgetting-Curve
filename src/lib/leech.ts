/**
 * Leech detection — flag cards that keep getting failed and refuse to stick.
 *
 * A "leech" (term from Anki's SuperMemo-derived scheduler) is a card that
 * drains study time: repeated lapses with no consolidation. Anki tags/suspends
 * such cards so the user *reformulates* them instead of grinding a broken card.
 *
 * We score leech-ness from per-concept counters plus the memory model's
 * half-life h (days), where P(recall) = 2^(-Δt/h) — Half-Life Regression,
 * Settles & Meeder (ACL 2016). The tell is a *short half-life despite a long
 * review history*: the card is seen often yet still decays fast.
 *
 * Pure and deterministic: no clock, no I/O. Verdicts are a function of counters,
 * so callers can snapshot and test them. All arithmetic is clamped to avoid
 * NaN/Infinity from missing or corrupt counters.
 */

export interface LeechInput {
  conceptId: string;
  title: string;
  totalReviews: number;
  incorrectCount: number;
  correctStreak: number;
  halfLifeDays: number;
  trapFailRate?: number;
}

export interface LeechVerdict {
  conceptId: string;
  title: string;
  isLeech: boolean;
  severity: number;
  lapseRate: number;
  reasons: string[];
}

// --- Detection thresholds -----------------------------------------------------
// A card needs real history before we accuse it of being a leech — early misses
// are just learning. 6 reviews is roughly two failed-then-relearned cycles.
const MIN_REVIEWS = 6;
// Absolute lapse count that reads as "chronic" regardless of review volume.
const HARD_LAPSES = 4;
// A high miss *rate* only condemns a card if it also won't consolidate, i.e. its
// half-life is short — otherwise a well-spaced card with old misses looks worse
// than it is. HLR half-lives under ~3 days mean "forgotten within days".
const HIGH_LAPSE_RATE = 0.4;
const SHORT_HALF_LIFE = 3;
// Trap fails = picked a confusable/near-synonym distractor. Missing half of them
// means the card tests a distinction the learner hasn't formed — a reformulation
// signal on its own.
const HIGH_TRAP_RATE = 0.5;

// --- Severity blend -----------------------------------------------------------
// Component weights sum to 1 so severity stays in [0,1]. Lapses (rate + count)
// dominate because they are the defining leech symptom; half-life and traps
// refine the ranking among cards that already fail a lot.
const W_LAPSE_RATE = 0.35;
const W_LAPSE_COUNT = 0.3;
const W_SHORT_HALF_LIFE = 0.2;
const W_TRAP = 0.15;
// Saturation scale for the lapse-count term: 1-exp(-n/k) reaches ~0.55 at 4
// lapses and ~0.8 at 8, so beyond a point more misses barely move the needle.
const LAPSE_COUNT_SCALE = 5;
// Decay scale for the half-life term: exp(-h/τ) is ~0.72 at 1d, ~0.37 at 3d,
// ~0.10 at 7d — short memories score high, long ones fade toward 0.
const HALF_LIFE_SCALE = 3;

/** Clamp to [0,1] and map any non-finite value to 0 so it can't poison a blend. */
function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Non-negative integer counter, defaulting a garbage/negative value to 0. */
function counter(x: number): number {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

export function detectLeech(c: LeechInput): LeechVerdict {
  // Sanitize counters up front — downstream math assumes finite, sane inputs.
  const totalReviews = counter(c.totalReviews);
  const incorrectCount = counter(c.incorrectCount);
  // Half-life is a positive duration; clamp so exp(-h/τ) can't blow up on a
  // negative or NaN half-life. Real HLR half-lives are always > 0.
  const halfLifeDays = Number.isFinite(c.halfLifeDays)
    ? Math.max(0, c.halfLifeDays)
    : 0;
  const trapFailRate = clamp01(c.trapFailRate ?? 0);

  // lapseRate per spec: incorrectCount / max(totalReviews, 1). Clamp to [0,1] in
  // case corrupt data reports more misses than reviews.
  const lapseRate = clamp01(incorrectCount / Math.max(totalReviews, 1));

  // Enough history AND at least one "keeps failing / won't consolidate" signal.
  const hasHistory = totalReviews >= MIN_REVIEWS;
  const chronicLapses = incorrectCount >= HARD_LAPSES;
  const failsAndForgets =
    lapseRate >= HIGH_LAPSE_RATE && halfLifeDays < SHORT_HALF_LIFE;
  const trapConfused = trapFailRate >= HIGH_TRAP_RATE;
  const isLeech =
    hasHistory && (chronicLapses || failsAndForgets || trapConfused);

  // Human-readable "why" for each signal that fired. Only surfaced once the card
  // has real history, so brand-new cards never generate scary copy.
  const reasons: string[] = [];
  if (hasHistory) {
    if (chronicLapses) {
      reasons.push(`${incorrectCount} lapse${incorrectCount === 1 ? "" : "s"}`);
    }
    if (lapseRate >= HIGH_LAPSE_RATE) {
      reasons.push(`fails ${Math.round(lapseRate * 100)}% of the time`);
    }
    if (halfLifeDays < SHORT_HALF_LIFE) {
      reasons.push(
        `still forgets in ${halfLifeDays.toFixed(1)}d after ${totalReviews} reviews`
      );
    }
    if (trapConfused) {
      reasons.push(
        `confuses similar meanings (${Math.round(trapFailRate * 100)}% trap fails)`
      );
    }
  }

  // Smooth, monotone blend in [0,1]. Each component rises with its "worse"
  // direction; weights sum to 1 so the total needs no rescaling, only a guard.
  const lapseCountComponent = 1 - Math.exp(-incorrectCount / LAPSE_COUNT_SCALE);
  const shortHalfLifeComponent = Math.exp(-halfLifeDays / HALF_LIFE_SCALE);
  const severity = clamp01(
    W_LAPSE_RATE * lapseRate +
      W_LAPSE_COUNT * lapseCountComponent +
      W_SHORT_HALF_LIFE * shortHalfLifeComponent +
      W_TRAP * trapFailRate
  );

  return {
    conceptId: c.conceptId,
    title: c.title,
    isLeech,
    severity,
    lapseRate,
    reasons,
  };
}

/** Verdict for every card, leeches first, then most-severe first within each group. */
export function rankLeeches(cs: LeechInput[]): LeechVerdict[] {
  return cs.map(detectLeech).sort((a, b) => {
    if (a.isLeech !== b.isLeech) return a.isLeech ? -1 : 1;
    return b.severity - a.severity;
  });
}
