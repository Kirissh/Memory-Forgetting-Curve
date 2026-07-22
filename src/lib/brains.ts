/**
 * Recall Brains — the app's single currency.
 *
 * Faucets: correct flashcards (+BRAINS_PER_CORRECT each) and a once-daily streak
 * bonus (bigger the longer your fire lasts). Sink: poker, where a lost hand costs
 * exactly what you staked. Every earning/spend also lands in a per-day activity log
 * that powers the GitHub-style contribution grid — poker counted by hands, study by
 * correct answers.
 */

import type { DailyActivity, User } from "./types";
import { STARTING_BRAINS, BRAINS_PER_CORRECT } from "./types";

export type ActivityDelta = {
  pokerHands?: number;
  correctCards?: number;
  /** Net brains from a poker hand (+win / −loss). Study earnings are derived. */
  pokerNet?: number;
};

export type GridDay = {
  date: string;
  count: number;
  pokerHands: number;
  correctCards: number;
  brains: number;
};

export type BrainsSummary = {
  balance: number;
  streak: number;
  longestStreak: number;
  today: { pokerHands: number; correctCards: number; brains: number };
  /** Oldest → newest, one entry per day for the last `days` days (default 119). */
  grid: GridDay[];
  /** Brains applied by the call that produced this summary (0 for reads). */
  delta?: number;
};

export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDaysUTC(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function activeDays(activity: DailyActivity[]): Set<string> {
  return new Set(
    activity
      .filter((a) => a.pokerHands + a.correctCards > 0)
      .map((a) => a.date)
  );
}

/** Consecutive active days ending today (or yesterday, if today is still empty). */
export function computeStreak(
  activity: DailyActivity[],
  today: string = todayUTC()
): number {
  const days = activeDays(activity);
  let cursor = today;
  if (!days.has(cursor)) {
    cursor = addDaysUTC(cursor, -1);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDaysUTC(cursor, -1);
  }
  return streak;
}

export function longestStreak(activity: DailyActivity[]): number {
  const days = [...activeDays(activity)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of days) {
    run = prev && addDaysUTC(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

/** Once-daily bonus: +5 per consecutive day the fire is alive, capped at 50. */
export function streakBonus(streak: number): number {
  return Math.min(50, 5 * Math.max(1, streak));
}

/** Most Brains a single session's efficiency bonus can be applied to. */
export const MAX_MULTIPLIER_BASE = 600;

/**
 * Study-efficiency → Brains multiplier. Efficiency is the share of on-task time you
 * were actually engaged (1 = never dawdled). Below 50% earns no bonus; a perfectly
 * focused session multiplies study earnings by 1.5×.
 */
export function efficiencyMultiplier(efficiency: number): number {
  const e = Math.max(0, Math.min(1, efficiency));
  return 1 + Math.max(0, (e - 0.5) / 0.5) * 0.5;
}

function buildGrid(
  activity: DailyActivity[],
  days: number,
  today: string
): GridDay[] {
  const byDate = new Map(activity.map((a) => [a.date, a]));
  const grid: GridDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDaysUTC(today, -i);
    const a = byDate.get(date);
    grid.push({
      date,
      pokerHands: a?.pokerHands ?? 0,
      correctCards: a?.correctCards ?? 0,
      brains: a?.brains ?? 0,
      count: (a?.pokerHands ?? 0) + (a?.correctCards ?? 0),
    });
  }
  return grid;
}

/** Read-only snapshot of a user's Recall Brains state. */
export function brainsSummary(user: User, days = 119): BrainsSummary {
  const activity = user.activity ?? [];
  const today = todayUTC();
  const todayEntry = activity.find((a) => a.date === today);
  return {
    balance: Math.max(0, Math.round(user.recallBrains ?? STARTING_BRAINS)),
    streak: computeStreak(activity, today),
    longestStreak: longestStreak(activity),
    today: {
      pokerHands: todayEntry?.pokerHands ?? 0,
      correctCards: todayEntry?.correctCards ?? 0,
      brains: todayEntry?.brains ?? 0,
    },
    grid: buildGrid(activity, days, today),
  };
}

/**
 * Apply a day's activity to the user in place: bump the day's counts, award study
 * + streak brains, subtract poker losses, and clamp the wallet at zero. Returns the
 * fresh summary (with `delta` = net brains this call). Mutates `user`.
 */
export function recordActivity(user: User, delta: ActivityDelta): BrainsSummary {
  const activity = user.activity ?? (user.activity = []);
  const today = todayUTC();

  let entry = activity.find((a) => a.date === today);
  const firstActivityToday =
    !entry || entry.pokerHands + entry.correctCards === 0;
  if (!entry) {
    entry = { date: today, pokerHands: 0, correctCards: 0, brains: 0 };
    activity.push(entry);
  }

  const pokerHands = Math.max(0, delta.pokerHands ?? 0);
  const correctCards = Math.max(0, delta.correctCards ?? 0);
  const pokerNet = Math.round(delta.pokerNet ?? 0);

  entry.pokerHands += pokerHands;
  entry.correctCards += correctCards;

  const correctBrains = correctCards * BRAINS_PER_CORRECT;

  // Streak bonus is paid once, on the first activity that lands today.
  let bonus = 0;
  if (firstActivityToday && pokerHands + correctCards > 0) {
    bonus = streakBonus(computeStreak(activity, today));
  }

  const net = correctBrains + bonus + pokerNet;
  entry.brains += net;
  user.recallBrains = Math.max(0, Math.round((user.recallBrains ?? STARTING_BRAINS) + net));

  return { ...brainsSummary(user), delta: net };
}
