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
 * Award an end-of-session study-efficiency bonus, once per session. The client
 * reports only how focused it was; the BASE the multiplier applies to is the study
 * Brains the server itself credited during that session (u.sessionStudy[sessionId]),
 * and each session can be claimed exactly once — so the bonus can't be inflated or
 * farmed by replaying the request.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: { sessionId?: unknown; efficiency?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const efficiency = Math.max(0, Math.min(1, Number(body.efficiency) || 0));
  const multiplier = efficiencyMultiplier(efficiency);

  try {
    let summary: BrainsSummary | undefined;
    let bonus = 0;
    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (!u) return;

      const claimed = u.bonusedSessions ?? (u.bonusedSessions = []);
      const earned = sessionId ? u.sessionStudy?.[sessionId] ?? 0 : 0;
      const eligible = sessionId && !claimed.includes(sessionId);

      if (eligible && earned > 0) {
        const base = Math.min(MAX_MULTIPLIER_BASE, earned);
        bonus = Math.round(base * (multiplier - 1));
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
      }
      if (eligible) {
        claimed.push(sessionId);
        if (claimed.length > 50) claimed.splice(0, claimed.length - 50);
        if (u.sessionStudy) delete u.sessionStudy[sessionId];
      }
      summary = brainsSummary(u);
    });

    return jsonOk({ ...summary, efficiency, multiplier, bonus });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Bonus failed", 500);
  }
}
