/**
 * Re-embed every stored chunk with the active EMBEDDING_BACKEND.
 *
 * Required after switching backends: hash and minilm vectors occupy unrelated
 * spaces, so a store holding both yields meaningless similarities rather than
 * merely weak ones.
 */
import { readDb, writeDb } from "../src/lib/db";
import { activeBackend, embed, EMBEDDING_DIM } from "../src/lib/embeddings";

async function main() {
  const backend = activeBackend();
  const db = await readDb();

  if (db.chunks.length === 0) {
    console.log("No chunks to re-embed. Run `npm run seed` first.");
    return;
  }

  console.log(`Re-embedding ${db.chunks.length} chunk(s) with '${backend}'…`);
  if (backend === "minilm") {
    console.log("(first run downloads ~23MB for Xenova/all-MiniLM-L6-v2)");
  }

  for (const [i, chunk] of db.chunks.entries()) {
    const vec = await embed(chunk.content);
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(
        `Backend '${backend}' returned ${vec.length}-d, expected ${EMBEDDING_DIM}`
      );
    }
    chunk.embedding = vec;
    process.stdout.write(`\r  ${i + 1}/${db.chunks.length}`);
  }

  await writeDb(db);
  console.log(`\nDone — ${db.chunks.length} chunk(s) now in '${backend}' space.`);
}

main().catch((err) => {
  console.error("\nRe-embed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
