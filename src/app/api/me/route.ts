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

// Allowed uploaded-image types (raster only — no SVG, which can carry script).
const ALLOWED_AVATAR_PREFIXES = [
  "data:image/png",
  "data:image/jpeg",
  "data:image/webp",
  "data:image/gif",
];

/**
 * Update the uploaded avatar image only. The Brains wallet is server-authoritative
 * — it is never settable by the client (it changes only via verified reviews, poker
 * outcomes, and shop purchases), so no balance field is accepted here.
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: { avatarImage?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (body.avatarImage === undefined) {
    return jsonError("avatarImage required");
  }

  // Validate the avatar up front so a bad payload changes nothing.
  let nextAvatar: string | null;
  if (body.avatarImage === null || body.avatarImage === "") {
    nextAvatar = null;
  } else if (
    typeof body.avatarImage === "string" &&
    ALLOWED_AVATAR_PREFIXES.some((p) => body.avatarImage!.toString().startsWith(p)) &&
    body.avatarImage.length <= MAX_AVATAR_CHARS
  ) {
    nextAvatar = body.avatarImage;
  } else {
    return jsonError("Invalid or oversized image");
  }

  try {
    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.avatarImage = nextAvatar;
    });
    return jsonOk({ avatarImage: nextAvatar });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to update profile",
      500
    );
  }
}
