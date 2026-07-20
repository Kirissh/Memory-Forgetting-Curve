import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { embed, cosineSimilarity } from "@/lib/embeddings";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";

/**
 * Free-recall grading: embed the learner's typed answer and the card's answer, and
 * score them by cosine similarity — a *semantic* match, not string equality, so
 * "makes ATP in the mitochondria" scores against "site of ATP production". The pass
 * threshold is tuned for MiniLM sentence embeddings; with the hash backend it falls
 * back to lexical overlap (still useful, just stricter).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const { cardId, answer } = (await req.json()) as {
      cardId: string;
      answer: string;
    };
    if (!cardId || typeof answer !== "string") {
      return jsonError("cardId and answer required");
    }

    const db = await readDb();
    const card = db.cards.find((c) => c.id === cardId);
    if (!card) return jsonError("Card not found", 404);
    const material = db.materials.find((m) => m.id === card.materialId);
    if (!material || material.userId !== user.id) {
      return jsonError("Forbidden", 403);
    }

    const target = card.clozeAnswer || card.back || "";
    const trimmed = answer.trim();
    if (!trimmed) {
      return jsonOk({ similarity: 0, correct: false, threshold: 0.55, target });
    }

    const [a, b] = await Promise.all([embed(trimmed), embed(target)]);
    const similarity = cosineSimilarity(a, b);
    const PASS = 0.55;
    return jsonOk({
      similarity,
      correct: similarity >= PASS,
      threshold: PASS,
      target,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Grade failed", 500);
  }
}
