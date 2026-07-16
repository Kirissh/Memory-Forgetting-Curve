/**
 * Local 384-d embeddings. Two backends, both 384-d so the pgvector migration
 * path stays compatible either way:
 *
 *   minilm (default) — Xenova/all-MiniLM-L6-v2 via transformers.js. Semantic,
 *                      runs locally, no API key. ~23MB model fetched on first
 *                      use and cached under node_modules.
 *   hash             — deterministic hash projection. Lexical overlap only, but
 *                      needs no download; set EMBEDDING_BACKEND=hash for
 *                      offline/CI runs.
 *
 * Vectors from the two backends are NOT comparable — they are unrelated vector
 * spaces, so a cosine similarity across them is noise, not a weak signal. Two
 * consequences, both deliberate:
 *
 *   1. Switching EMBEDDING_BACKEND invalidates every stored vector. Re-embed
 *      with `npm run reembed`.
 *   2. embed() throws when the model fails to load instead of falling back to
 *      hash. A fallback would look like it worked while quietly poisoning the
 *      concept store with mixed spaces — the resulting bad recommendations
 *      would surface much later, far from the cause.
 */

const DIM = 384;
export const EMBEDDING_DIM = DIM;

export type EmbeddingBackend = "minilm" | "hash";

export function activeBackend(): EmbeddingBackend {
  return process.env.EMBEDDING_BACKEND === "hash" ? "hash" : "minilm";
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MINILM_MODEL = "Xenova/all-MiniLM-L6-v2";

// transformers.js holds the model in memory; one shared load for the process.
type Extractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = import("@xenova/transformers")
      .then(async (mod) => {
        mod.env.allowLocalModels = false;
        return (await mod.pipeline("feature-extraction", MINILM_MODEL, {
          quantized: true,
        })) as unknown as Extractor;
      })
      .catch((err) => {
        extractorPromise = null; // don't cache the failure; let the next call retry
        throw err;
      });
  }
  return extractorPromise;
}

export async function embedWithTransformers(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export async function embed(text: string): Promise<number[]> {
  if (!tokenize(text).length) return new Array(DIM).fill(0);
  return activeBackend() === "hash"
    ? embedHashProjection(text)
    : embedWithTransformers(text);
}

export async function embedHashProjection(text: string): Promise<number[]> {
  const vec = new Float64Array(DIM);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);

  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % DIM;
    const sign = h & 1 ? 1 : -1;
    vec[idx] += sign;
    // second hash for denser coverage
    const h2 = hashToken(token + "#2");
    vec[h2 % DIM] += h2 & 1 ? 0.5 : -0.5;
  }

  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function chunkText(
  text: string,
  targetChars = 1200,
  overlap = 150
): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > targetChars && current) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + "\n\n" + p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Fallback sliding window for giant blocks
  if (chunks.length === 1 && chunks[0].length > targetChars * 2) {
    const out: string[] = [];
    const big = chunks[0];
    for (let i = 0; i < big.length; i += targetChars - overlap) {
      out.push(big.slice(i, i + targetChars));
    }
    return out.filter(Boolean);
  }

  return chunks;
}
