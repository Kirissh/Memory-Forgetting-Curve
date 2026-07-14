import { getCurrentUser } from "@/lib/auth";
import { readDb, updateDb } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const db = await readDb();
  const material = db.materials.find((m) => m.id === id && m.userId === user.id);
  if (!material) return jsonError("Not found", 404);

  const concepts = db.concepts
    .filter((c) => c.materialId === id)
    .map((c) => {
      const card = db.cards.find((card) => card.conceptId === c.id);
      return { ...c, card };
    });

  return jsonOk({ material, concepts });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  try {
    await updateDb((db) => {
      const material = db.materials.find(
        (m) => m.id === id && m.userId === user.id
      );
      if (!material) throw new Error("Not found");
      const conceptIds = new Set(
        db.concepts.filter((c) => c.materialId === id).map((c) => c.id)
      );
      const cardIds = new Set(
        db.cards.filter((c) => c.materialId === id).map((c) => c.id)
      );
      db.materials = db.materials.filter((m) => m.id !== id);
      db.chunks = db.chunks.filter((c) => c.materialId !== id);
      db.concepts = db.concepts.filter((c) => c.materialId !== id);
      db.cards = db.cards.filter((c) => c.materialId !== id);
      db.reviews = db.reviews.filter(
        (r) => !cardIds.has(r.cardId) && !conceptIds.has(r.conceptId)
      );
      if (db.encodings) {
        db.encodings = db.encodings.filter(
          (e) => !cardIds.has(e.cardId) && !conceptIds.has(e.conceptId)
        );
      }
    });
    return jsonOk({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return jsonError(msg, msg === "Not found" ? 404 : 500);
  }
}
