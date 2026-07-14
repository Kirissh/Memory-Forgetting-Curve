import { v4 as uuid } from "uuid";
import { getCurrentUser } from "@/lib/auth";
import { updateDb, readDb } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";

/** Record a learn-phase exposure: dwell time + 1–5 ease-of-learning judgment. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json();
    const { cardId, sessionId, readTimeMs, difficulty } = body as {
      cardId: string;
      sessionId?: string;
      readTimeMs?: number;
      difficulty?: number;
    };

    if (!cardId) return jsonError("cardId required");
    const diff = Number(difficulty);
    if (!Number.isFinite(diff) || diff < 1 || diff > 5) {
      return jsonError("difficulty must be 1–5");
    }

    const db = await readDb();
    const card = db.cards.find((c) => c.id === cardId);
    if (!card) return jsonError("Card not found", 404);
    const material = db.materials.find((m) => m.id === card.materialId);
    if (!material || material.userId !== user.id) {
      return jsonError("Forbidden", 403);
    }
    const concept = db.concepts.find((c) => c.id === card.conceptId);
    if (!concept) return jsonError("Concept not found", 404);

    const now = new Date().toISOString();
    const readMs = Math.max(0, Number(readTimeMs) || 0);

    await updateDb((d) => {
      if (!d.encodings) d.encodings = [];
      d.encodings.push({
        id: uuid(),
        userId: user.id,
        cardId,
        conceptId: concept.id,
        sessionId: sessionId || uuid(),
        readTimeMs: readMs,
        difficulty: diff,
        encodedAt: now,
      });

      const c = d.concepts.find((x) => x.id === concept.id)!;
      const n = (c.learnCount || 0) + 1;
      c.learnCount = n;
      c.avgDifficulty =
        ((c.avgDifficulty || diff) * (n - 1) + diff) / n;
      if (readMs > 0) {
        c.avgReadTimeMs =
          ((c.avgReadTimeMs || readMs) * (n - 1) + readMs) / n;
      }
      c.lastLearnedAt = now;
    });

    return jsonOk({ ok: true, difficulty: diff });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Encoding failed",
      500
    );
  }
}
