import { getCurrentUser } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { jsonOk, jsonError, unauthorized } from "@/lib/api";
import { brainsSummary } from "@/lib/brains";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const brains = brainsSummary(user);
  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      // recallBrains is the live wallet; pokerCredits kept as a legacy alias.
      recallBrains: brains.balance,
      pokerCredits: brains.balance,
      streak: brains.streak,
      equippedFrame: user.equippedFrame ?? null,
    },
    brains,
  });
}

/** Directly set the Recall Brains balance (losses stick — no soft rebuy). */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json();
    const raw = Number(body.recallBrains ?? body.pokerCredits);
    if (!Number.isFinite(raw)) {
      return jsonError("recallBrains required");
    }
    const balance = Math.max(0, Math.round(raw));

    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.recallBrains = balance;
    });

    return jsonOk({ recallBrains: balance, pokerCredits: balance });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to update brains",
      500
    );
  }
}
