/**
 * Build meaning-verification probes and poker MCQ choices for a flashcard.
 * Half the time the statement is still true (paraphrased summary);
 * half the time meaning is deliberately inverted so the learner
 * must discriminate — closer to recognition memory tests than self-grading.
 */

const NEGATIONS = [
  [/ is /i, " is not "],
  [/ are /i, " are not "],
  [/ can /i, " cannot "],
  [/ enables /i, " prevents "],
  [/ increases /i, " decreases "],
  [/ decreases /i, " increases "],
  [/ positive /i, " negative "],
  [/ negative /i, " positive "],
  [/ before /i, " after "],
  [/ after /i, " before "],
  [/ high /i, " low "],
  [/ low /i, " high "],
  [/ more /i, " less "],
  [/ less /i, " more "],
  [/ causes /i, " is caused by "],
  [/ includes /i, " excludes "],
  [/ strengthens /i, " weakens "],
  [/ weakens /i, " strengthens "],
] as const;

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Compress a definition into a short claim the learner can judge quickly. */
export function summarizeMeaning(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;

  // Prefer the first clause / sentence as the gist.
  const clause =
    cleaned.split(/(?<=[.:;—–])\s+/)[0]?.replace(/[.!?;:]+$/, "").trim() ||
    cleaned;

  const words = clause.split(/\s+/);
  let summary =
    words.length > 18 ? `${words.slice(0, 16).join(" ")}…` : clause;

  // Soft paraphrase so same-meaning probes aren't a verbatim copy.
  summary = summary
    .replace(/\bwhich is\b/gi, "that is")
    .replace(/\breferred to as\b/gi, "known as")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\butilizes\b/gi, "uses")
    .replace(/\bapproximately\b/gi, "about")
    .replace(/\bthe process of\b/gi, "")
    .replace(/\bdefined as\b/gi, "essentially")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Capitalize for a standalone claim.
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

/** Invert a summary into a coherent opposite claim (never "Opposite of: …"). */
export function oppositeMeaning(summary: string, seed: number): string {
  const base = summary.replace(/\s+/g, " ").trim();
  if (!base) return "An unrelated claim that does not match this concept.";

  // Prefer a real antonym / negation swap inside the sentence.
  const attempt = NEGATIONS[seed % NEGATIONS.length];
  if (attempt[0].test(base)) {
    const flipped = base.replace(attempt[0], attempt[1]).trim();
    if (flipped.toLowerCase() !== base.toLowerCase()) {
      return flipped.charAt(0).toUpperCase() + flipped.slice(1);
    }
  }

  // Try other negation patterns until one sticks.
  for (let i = 0; i < NEGATIONS.length; i++) {
    const [re, rep] = NEGATIONS[(seed + i) % NEGATIONS.length];
    if (re.test(base)) {
      const flipped = base.replace(re, rep).trim();
      if (flipped.toLowerCase() !== base.toLowerCase()) {
        return flipped.charAt(0).toUpperCase() + flipped.slice(1);
      }
    }
  }

  // Semantic redirects that still read as full claims.
  const lower = base.charAt(0).toLowerCase() + base.slice(1);
  const fallbacks = [
    `It is not the case that ${lower}`,
    `The reverse is true: ${lower.replace(/\bis not\b/gi, "is").replace(/\bis\b/i, "is not")}`,
    `${base.replace(/\.$/, "")} — except the opposite holds in practice.`,
    `Rather than this, the concept means the inverse of: ${lower}`,
  ];
  return fallbacks[seed % fallbacks.length];
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

function distractorClaim(summary: string, seed: number, variant: number): string {
  const s = summary;
  const lower = s.charAt(0).toLowerCase() + s.slice(1);
  const options = [
    oppositeMeaning(s, seed + variant),
    s.replace(
      /\b(memory|learning|network|model|system|process|energy|cell|agent|concept)\b/i,
      "unrelated idea"
    ),
    `Never involves ${lower}`,
    s.replace(/\d+/g, (n) => String(Number(n) * 10 || 7)),
    `A different idea entirely: ${lower.replace(/\bis\b/i, "is not")}`,
  ];
  let pick = options[variant % options.length].replace(/\s{2,}/g, " ").trim();
  if (pick.toLowerCase() === s.toLowerCase()) {
    pick = oppositeMeaning(s, seed + variant + 3);
  }
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

export type MeaningProbe = {
  /** Short summary-style statement shown as the claimed meaning */
  statement: string;
  /** Ground truth: does this statement match the flashcard? */
  isSameMeaning: boolean;
  /** The clean summary used as the true gist (for feedback) */
  trueSummary: string;
};

/** Words too generic to make a useful cloze deletion. */
const CLOZE_STOP = new Set([
  "which",
  "that",
  "this",
  "these",
  "those",
  "their",
  "there",
  "where",
  "about",
  "into",
  "from",
  "with",
  "without",
  "between",
  "across",
  "through",
  "because",
  "process",
]);

/**
 * Deterministic cloze deletion: blank the longest content word so the learner must
 * produce it. Returns null when nothing salient enough exists (very short defs).
 */
export function buildCloze(
  text: string
): { clozeText: string; clozeAnswer: string } | null {
  const words = text.split(/\s+/);
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^A-Za-z-]/g, "");
    if (w.length <= 5 || CLOZE_STOP.has(w.toLowerCase())) continue;
    if (w.length > bestLen) {
      bestLen = w.length;
      best = i;
    }
  }
  if (best < 0) return null;
  const answer = words[best].replace(/[^A-Za-z-]/g, "");
  const clozeText = words
    .map((w, i) => (i === best ? w.replace(answer, "_____") : w))
    .join(" ");
  return { clozeText, clozeAnswer: answer };
}

export function buildMeaningProbe(
  definition: string,
  cardId: string,
  sessionSalt = ""
): MeaningProbe {
  const seed = hashSeed(`${cardId}:${sessionSalt}:${definition.slice(0, 40)}`);
  const trueSummary = summarizeMeaning(definition);
  const isSameMeaning = seed % 2 === 0;

  let statement = isSameMeaning
    ? lightlyParaphrase(trueSummary)
    : oppositeMeaning(trueSummary, seed);

  // Avoid accidental identical strings for traps
  if (!isSameMeaning && statement.toLowerCase() === trueSummary.toLowerCase()) {
    statement = `It is not the case that ${trueSummary.charAt(0).toLowerCase()}${trueSummary.slice(1)}`;
  }

  return { statement, isSameMeaning, trueSummary };
}

export type PokerChoice = {
  id: string;
  text: string;
  correct: boolean;
};

export type PokerRound = {
  /** Prompt shown above the options */
  prompt: string;
  choices: PokerChoice[];
  trueSummary: string;
};

/**
 * Four-option MCQ for poker mode: one correct summary + three inverted / diverted claims.
 * Order is deterministic from the card + session salt.
 */
export function buildPokerRound(
  definition: string,
  cardId: string,
  sessionSalt = ""
): PokerRound {
  const seed = hashSeed(`poker:${cardId}:${sessionSalt}:${definition.slice(0, 40)}`);
  const trueSummary = summarizeMeaning(definition);
  const correctText = lightlyParaphrase(trueSummary);

  // Collect three DISTINCT distractors — distractorClaim can otherwise collide with
  // itself (or the correct answer), showing the player two identical options.
  const used = new Set([correctText.toLowerCase().trim()]);
  const distractors: string[] = [];
  for (let variant = 1; distractors.length < 3 && variant < 40; variant++) {
    const d = distractorClaim(trueSummary, seed, variant);
    const key = d.toLowerCase().trim();
    if (!key || used.has(key)) continue;
    used.add(key);
    distractors.push(d);
  }
  // Guaranteed-unique fillers for degenerate definitions that can't yield 3.
  while (distractors.length < 3) {
    const filler = `This is not what the concept means (option ${distractors.length + 1}).`;
    used.add(filler.toLowerCase());
    distractors.push(filler);
  }

  const raw: PokerChoice[] = [
    { id: "a", text: correctText, correct: true },
    { id: "b", text: distractors[0], correct: false },
    { id: "c", text: distractors[1], correct: false },
    { id: "d", text: distractors[2], correct: false },
  ];

  // Fisher–Yates with seeded PRNG
  let state = seed || 1;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = raw.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [raw[i], raw[j]] = [raw[j], raw[i]];
  }

  // Re-letter after shuffle so labels stay A–D in display order
  const labels = ["A", "B", "C", "D"];
  const choices = raw.map((c, i) => ({ ...c, id: labels[i] }));

  return {
    prompt: "Which summary matches the real meaning?",
    choices,
    trueSummary,
  };
}
