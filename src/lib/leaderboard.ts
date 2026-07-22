/**
 * Leaderboard stats — total study time and study efficiency, ranked across real
 * accounts plus the poker rivals (so a solo player still has a table to climb).
 * Study time and efficiency are derived from the review log using the same
 * engagement caps as the in-session efficiency score.
 */

import type { Review, User } from "./types";
import { POKER_BOTS, type PokerBot } from "./pokerBots";
import { computeStreak } from "./brains";

const READ_CAP_MS = 45_000;
const RESP_CAP_MS = 30_000;

export type LeaderKind = "you" | "user" | "rival";

export type LeaderRow = {
  id: string;
  name: string;
  kind: LeaderKind;
  studyMinutes: number;
  efficiency: number; // 0..1
  correct: number;
  streak: number;
  color?: string;
  avatarImage?: string | null;
  equippedFrame?: string | null;
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1;
}

/** Aggregate a real user's engaged minutes + efficiency from their reviews. */
export function userLeaderStats(
  user: User,
  reviews: Review[]
): Omit<LeaderRow, "kind"> {
  let raw = 0;
  let focus = 0;
  let correct = 0;
  for (const r of reviews) {
    if (r.userId !== user.id) continue;
    const read = Math.max(0, r.readTimeMs ?? 0);
    const resp = Math.max(0, r.responseTimeMs ?? 0);
    raw += read + resp;
    focus += Math.min(read, READ_CAP_MS) + Math.min(resp, RESP_CAP_MS);
    if (r.correct) correct += 1;
  }
  return {
    id: user.id,
    name: user.name || user.email.split("@")[0],
    studyMinutes: Math.round(focus / 60_000),
    efficiency: raw > 0 ? focus / raw : 0,
    correct,
    streak: computeStreak(user.activity ?? []),
    avatarImage: user.avatarImage ?? null,
    equippedFrame: user.equippedFrame ?? null,
  };
}

/** Deterministic rival stats seeded from the bot id, scaled by their skill. */
export function botLeaderRow(bot: PokerBot): LeaderRow {
  const seed = hashSeed(`leader:${bot.id}`);
  const studyMinutes = Math.round(40 + bot.skill * 140 + (seed % 45));
  const efficiency = Math.min(
    0.98,
    0.58 + bot.skill * 0.34 + ((seed >> 4) % 8) / 100
  );
  return {
    id: bot.id,
    name: bot.name,
    kind: "rival",
    studyMinutes,
    efficiency,
    correct: Math.round(studyMinutes * (0.4 + bot.skill * 0.4)),
    streak: 1 + (seed % 14),
    color: bot.color,
  };
}

/** Assemble the full leaderboard for `currentUserId`. */
export function buildLeaderboard(
  users: User[],
  reviews: Review[],
  currentUserId: string
): LeaderRow[] {
  const real: LeaderRow[] = users.map((u) => ({
    ...userLeaderStats(u, reviews),
    kind: u.id === currentUserId ? "you" : "user",
  }));
  const rivals = POKER_BOTS.map(botLeaderRow);
  return [...real, ...rivals];
}
