import { getCurrentUser } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { jsonOk, jsonError, unauthorized } from "@/lib/api";
import { STARTING_BRAINS } from "@/lib/types";
import {
  brainsSummary,
  efficiencyMultiplier,
  todayUTC,
  MAX_MULTIPLIER_BASE,
  type BrainsSummary,
} from "@/lib/brains";

/** Recall Brains summary: balance, streak, and the contribution grid. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return jsonOk(brainsSummary(user));
}

/**
 * Award an end-of-session study-efficiency bonus. The client reports how focused
 * the session was and how many Brains it earned; the server recomputes the
 * multiplier so the bonus can't be inflated.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json().catch(() => ({}));
    const efficiency = Math.max(0, Math.min(1, Number(body.efficiency) || 0));
    const baseEarned = Math.max(
      0,
      Math.min(MAX_MULTIPLIER_BASE, Math.round(Number(body.baseEarned) || 0))
    );
    const multiplier = efficiencyMultiplier(efficiency);
    const bonus = Math.round(baseEarned * (multiplier - 1));

    let summary: BrainsSummary | undefined;
    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (!u) return;
      if (bonus > 0) {
        u.recallBrains = Math.max(
          0,
          Math.round((u.recallBrains ?? STARTING_BRAINS) + bonus)
        );
        const today = todayUTC();
        const act = u.activity ?? (u.activity = []);
        let entry = act.find((a) => a.date === today);
        if (!entry) {
          entry = { date: today, pokerHands: 0, correctCards: 0, brains: 0 };
          act.push(entry);
        }
        entry.brains += bonus;
      }
      summary = brainsSummary(u);
    });

    return jsonOk({ ...summary, efficiency, multiplier, bonus });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Bonus failed",
      500
    );
  }
}
