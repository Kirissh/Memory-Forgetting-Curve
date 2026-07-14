/**
 * Build meaning-verification probes for a flashcard.
 * Half the time the statement is still true (paraphrase);
 * half the time meaning is deliberately corrupted so the learner
 * must discriminate — closer to recognition memory tests than self-grading.
 */

const NEGATIONS = [
  [/ is /i, " is not "],
  [/ are /i, " are not "],
  [/ can /i, " cannot "],
  [/ enables /i, " prevents "],
  [/ increases /i, " decreases "],
  [/ positive /i, " negative "],
  [/ before /i, " after "],
  [/ high /i, " low "],
  [/ more /i, " less "],
] as const;

const CORRUPTIONS: Array<(s: string) => string> = [
  (s) => s.replace(/\b(memory|learning|network|model|system|process|energy|cell|agent)\b/i, " unrelated concept "),
  (s) => `Opposite of: ${s}`,
  (s) => s.replace(/\d+/g, (n) => String(Number(n) * 10 || 7)),
  (s) => `Never involves ${s.charAt(0).toLowerCase()}${s.slice(1)}`,
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function lightlyParaphrase(text: string): string {
  return text
    .replace(/\bwhich is\b/gi, "that is")
    .replace(/\breferred to as\b/gi, "known as")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\butilizes\b/gi, "uses")
    .replace(/\bapproximately\b/gi, "about")
    .trim();
}

function corruptMeaning(text: string, seed: number): string {
  const attempt = NEGATIONS[seed % NEGATIONS.length];
  if (attempt[0].test(text)) {
    return text.replace(attempt[0], attempt[1]).trim();
  }
  return CORRUPTIONS[seed % CORRUPTIONS.length](text).trim();
}

export type MeaningProbe = {
  /** Statement shown as "claimed meaning" */
  statement: string;
  /** Ground truth: does this statement match the flashcard? */
  isSameMeaning: boolean;
};

export function buildMeaningProbe(
  definition: string,
  cardId: string,
  sessionSalt = ""
): MeaningProbe {
  const seed = hashSeed(`${cardId}:${sessionSalt}:${definition.slice(0, 40)}`);
  const isSameMeaning = seed % 2 === 0;
  const statement = isSameMeaning
    ? lightlyParaphrase(definition)
    : corruptMeaning(definition, seed);

  // Avoid accidental identical strings for traps
  if (!isSameMeaning && statement.toLowerCase() === definition.toLowerCase()) {
    return {
      statement: `The opposite claim: ${definition}`,
      isSameMeaning: false,
    };
  }

  return { statement, isSameMeaning };
}
