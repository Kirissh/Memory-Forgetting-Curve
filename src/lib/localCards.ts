/**
 * Offline flashcard generation — an extractive fallback for when the LLM is
 * unavailable (rate-limited, down, or offline demo). Never as good as the LLM,
 * but it GUARANTEES a material ends up with cards, so uploads always "work".
 */
import type { GeneratedFlashcard } from "./llm";

/** Split a block of text into clean, card-sized sentences. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 320);
}

/** Pull a "Term is/are/means …" or "Term: definition" concept from a sentence. */
function conceptFromSentence(
  s: string
): { concept: string; definition: string } | null {
  const m = s.match(
    /^(.{2,60}?)\s+(?:is|are|was|were|refers?\s+to|means?|describes?|defines?|denotes?)\s+(.+)$/i
  );
  if (m) {
    const concept = m[1].replace(/^(the|a|an)\s+/i, "").trim();
    if (concept.length >= 2) return { concept: concept.slice(0, 80), definition: s };
  }
  const m2 = s.match(/^([^:–—-]{2,60})\s*[:–—-]\s+(.{10,})$/);
  if (m2) return { concept: m2[1].trim().slice(0, 80), definition: s };
  return null;
}

/** Blank the longest content word of a sentence for a recall prompt. */
function clozePrompt(s: string): { concept: string; front: string } {
  const words = s.split(/\s+/);
  const key =
    [...words].sort((a, b) => b.replace(/\W/g, "").length - a.replace(/\W/g, "").length)[0] ||
    words[0] ||
    "";
  const bare = key.replace(/[^A-Za-z0-9-]/g, "");
  const concept = bare.slice(0, 60) || "this idea";
  const front = bare
    ? "Fill in the blank: " + s.replace(bare, "_____")
    : "Recall: " + s;
  return { concept, front };
}

export function localFlashcards(text: string, max = 6): GeneratedFlashcard[] {
  const sents = sentences(text);
  const cards: GeneratedFlashcard[] = [];
  const seen = new Set<string>();
  const usedSentences = new Set<string>();

  // Pass 1 — real "Term is/means …" definitions make the cleanest cards.
  for (const s of sents) {
    const c = conceptFromSentence(s);
    if (!c) continue;
    const key = c.concept.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    usedSentences.add(s);
    cards.push({
      concept: c.concept,
      definition: c.definition,
      flashcard_front: `What is ${c.concept}?`,
      flashcard_back: c.definition,
    });
    if (cards.length >= max) return cards;
  }

  // Pass 2 — top up with cloze recall from the remaining substantial sentences,
  // so even prose with no explicit definitions yields a full deck.
  for (const s of sents) {
    if (cards.length >= Math.max(3, max)) break;
    if (usedSentences.has(s)) continue;
    const { concept, front } = clozePrompt(s);
    const key = concept.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      concept,
      definition: s,
      flashcard_front: front,
      flashcard_back: s,
    });
  }

  return cards;
}
