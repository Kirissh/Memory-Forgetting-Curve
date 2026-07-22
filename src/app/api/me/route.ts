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
      avatarImage: user.avatarImage ?? null,
    },
    brains,
  });
}

// Cap the stored avatar data URL (~0.5 MB of base64) so db.json stays small.
const MAX_AVATAR_CHARS = 700_000;

/** Update the wallet balance and/or the uploaded avatar image. */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json();

    // Validate the avatar up front so a bad payload changes nothing.
    let nextAvatar: string | null | undefined;
    if (body.avatarImage !== undefined) {
      if (body.avatarImage === null || body.avatarImage === "") {
        nextAvatar = null;
      } else if (
        typeof body.avatarImage === "string" &&
        body.avatarImage.startsWith("data:image/") &&
        body.avatarImage.length <= MAX_AVATAR_CHARS
      ) {
        nextAvatar = body.avatarImage;
      } else {
        return jsonError("Invalid or oversized image");
      }
    }

    let balance = Math.max(0, Math.round(user.recallBrains ?? 0));
    let avatarImage = user.avatarImage ?? null;

    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (!u) return;
      const raw = Number(body.recallBrains ?? body.pokerCredits);
      if (Number.isFinite(raw)) {
        u.recallBrains = Math.max(0, Math.round(raw));
        balance = u.recallBrains;
      }
      if (nextAvatar !== undefined) {
        u.avatarImage = nextAvatar;
        avatarImage = nextAvatar;
      }
    });

    return jsonOk({ recallBrains: balance, pokerCredits: balance, avatarImage });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to update profile",
      500
    );
  }
}
