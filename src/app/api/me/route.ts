import { getCurrentUser } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { jsonOk, jsonError, unauthorized } from "@/lib/api";
import { STARTING_POKER_CREDITS } from "@/lib/types";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const credits = user.pokerCredits ?? STARTING_POKER_CREDITS;
  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      pokerCredits: credits,
    },
  });
}

/** Persist poker chip balance after a session (or soft top-up when broke). */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json();
    let credits = Number(body.pokerCredits);
    if (!Number.isFinite(credits)) {
      return jsonError("pokerCredits required");
    }
    credits = Math.max(0, Math.round(credits));
    // Soft rebuy so a wiped wallet can still play next session
    if (credits < 50) credits = STARTING_POKER_CREDITS;

    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.pokerCredits = credits;
    });

    return jsonOk({ pokerCredits: credits });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to update credits",
      500
    );
  }
}
