import { getCurrentUser } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { jsonOk, jsonError, unauthorized } from "@/lib/api";
import { STARTING_BRAINS } from "@/lib/types";
import { FRAMES, getFrame } from "@/lib/frames";

function snapshot(
  balance: number,
  owned: string[],
  equipped: string | null
) {
  return {
    balance,
    ownedFrames: owned,
    equippedFrame: equipped,
    frames: FRAMES.map((f) => ({
      ...f,
      owned: owned.includes(f.id),
      equipped: equipped === f.id,
    })),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return jsonOk(
    snapshot(
      Math.max(0, Math.round(user.recallBrains ?? STARTING_BRAINS)),
      user.ownedFrames ?? [],
      user.equippedFrame ?? null
    )
  );
}

/** Buy a frame (spends Brains) or equip one you already own. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let action: "buy" | "equip" | undefined;
  let frameId: string | null | undefined;
  try {
    const parsed = (await req.json()) as {
      action?: "buy" | "equip";
      frameId?: string | null;
    };
    action = parsed.action;
    frameId = parsed.frameId;
  } catch {
    return jsonError("Invalid JSON body");
  }

  try {
    if (action !== "buy" && action !== "equip") {
      return jsonError("action must be 'buy' or 'equip'");
    }

    // Equipping the bare avatar (no frame) is always allowed.
    if (action === "equip" && !frameId) {
      let out;
      await updateDb((d) => {
        const u = d.users.find((x) => x.id === user.id)!;
        u.equippedFrame = null;
        out = snapshot(
          Math.max(0, Math.round(u.recallBrains ?? STARTING_BRAINS)),
          u.ownedFrames ?? [],
          null
        );
      });
      return jsonOk(out);
    }

    const frame = getFrame(frameId);
    if (!frame) return jsonError("Unknown frame", 404);

    let out;
    let failure: string | null = null;

    await updateDb((d) => {
      const u = d.users.find((x) => x.id === user.id)!;
      const owned = u.ownedFrames ?? (u.ownedFrames = []);
      const balance = Math.max(0, Math.round(u.recallBrains ?? STARTING_BRAINS));

      if (action === "buy") {
        if (owned.includes(frame.id)) {
          failure = "Already owned";
          return;
        }
        if (balance < frame.price) {
          failure = "Not enough Brains";
          return;
        }
        u.recallBrains = balance - frame.price;
        owned.push(frame.id);
        u.equippedFrame = frame.id; // wear it right away
      } else {
        // equip
        if (!owned.includes(frame.id)) {
          failure = "You don't own that frame";
          return;
        }
        u.equippedFrame = frame.id;
      }

      out = snapshot(
        Math.max(0, Math.round(u.recallBrains ?? STARTING_BRAINS)),
        owned,
        u.equippedFrame ?? null
      );
    });

    if (failure) return jsonError(failure, 400);
    return jsonOk(out);
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Shop action failed",
      500
    );
  }
}
