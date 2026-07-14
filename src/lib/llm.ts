import OpenAI from "openai";
import { z } from "zod";

const FlashcardSchema = z.object({
  concept: z.string(),
  definition: z.string(),
  flashcard_front: z.string(),
  flashcard_back: z.string(),
});

const FlashcardArraySchema = z.array(FlashcardSchema);

function getClient() {
  return new OpenAI({
    baseURL: "https://api.llm7.io/v1",
    apiKey: process.env.LLM7_API_KEY || "unused",
  });
}

/** Prefer env override; LLM7 free tier currently routes via codestral-latest. */
function getModel() {
  return process.env.LLM7_MODEL || "codestral-latest";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    const objMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const parsed = JSON.parse(objMatch[0]);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.flashcards)) return parsed.flashcards;
      if (Array.isArray(parsed.cards)) return parsed.cards;
      return [parsed];
    }
    throw new Error("Model did not return valid JSON");
  }
}

export type GeneratedFlashcard = z.infer<typeof FlashcardSchema>;

export async function generateFlashcards(
  chunkText: string,
  retries = 3
): Promise<GeneratedFlashcard[]> {
  const llm = getClient();
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await llm.chat.completions.create({
        model: getModel(),
        messages: [
          {
            role: "system",
            content:
              "You are a study assistant. Extract 3-6 key concepts from the given text and return ONLY valid JSON: an array of {concept, definition, flashcard_front, flashcard_back}. No markdown, no commentary. flashcard_front should be a short question; flashcard_back a concise answer grounded in the text.",
          },
          { role: "user", content: chunkText.slice(0, 4000) },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty LLM response");

      const parsed = extractJson(content);
      const cards = FlashcardArraySchema.parse(parsed);
      return cards.filter(
        (c) =>
          c.concept.trim() &&
          c.flashcard_front.trim() &&
          c.flashcard_back.trim()
      );
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const delay = status === 429 ? 2000 * (attempt + 1) : 800 * (attempt + 1);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Flashcard generation failed");
}
