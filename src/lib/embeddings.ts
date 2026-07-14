/**
 * Lightweight local embeddings (384-d) — deterministic hash projection.
 * Mimics MiniLM dimensionality so pgvector migrations stay compatible.
 * Swap for @xenova/transformers Xenova/all-MiniLM-L6-v2 when you want
 * semantic quality (see embedWithTransformers below).
 */

const DIM = 384;

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

export async function embed(text: string): Promise<number[]> {
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
