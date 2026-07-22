/**
 * Rival bots for poker-table study mode.
 * Rivals no longer carry a running chip stack — each hand they simply ante into the
 * pot, betting bigger on harder questions. Answer correctly and you take the whole
 * pot (everyone's antes); miss and you lose your stake.
 */

export type PokerBotId = "kirissh" | "arnav" | "harshith" | "sai";

export type PokerBot = {
  id: PokerBotId;
  name: string;
  /** Probability they pick the correct MCQ option */
  skill: number;
  /** How much they ante relative to the table: tight < normal < loose */
  aggression: "tight" | "normal" | "loose";
  color: string;
  tagline: string;
};

export const POKER_BOTS: PokerBot[] = [
  { id: "kirissh", name: "Kirissh", skill: 0.78, aggression: "normal", color: "#8eb4e8", tagline: "reads the room" },
  { id: "arnav", name: "Arnav", skill: 0.55, aggression: "loose", color: "#e8c48e", tagline: "all-in energy" },
  { id: "harshith", name: "Harshith", skill: 0.68, aggression: "tight", color: "#9ee0c0", tagline: "slow & steady" },
  { id: "sai", name: "Sai", skill: 0.82, aggression: "normal", color: "#c9a8f0", tagline: "quietly deadly" },
];

export type BotHandResult = {
  botId: PokerBotId;
  name: string;
  color: string;
  /** Chips this rival anted into the pot for the hand. */
  bet: number;
  /** Their pick + whether it was right — only when `choices` are supplied (display). */
  choiceId?: string;
  correct?: boolean;
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1;
}

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** 0 (easy) … 1 (hard) from a card's difficulty, miss history, and fade risk. */
export function cardHardness(c: {
  avgDifficulty?: number | null;
  incorrectCount?: number;
  recallProbability?: number;
}): number {
  const diff = (((c.avgDifficulty ?? 3) - 1) / 4); // 1..5 -> 0..1
  const missed = Math.min(1, (c.incorrectCount ?? 0) / 3);
  const fade = 1 - Math.max(0, Math.min(1, c.recallProbability ?? 0.5));
  return Math.max(0, Math.min(1, 0.5 * diff + 0.3 * missed + 0.2 * fade));
}

/** A rival's ante: aggressive rivals ante more, and everyone antes up on hard cards. */
function botAnte(bot: PokerBot, hardness: number, rand: () => number): number {
  const h = Math.max(0, Math.min(1, hardness));
  const mult = bot.aggression === "tight" ? 0.7 : bot.aggression === "loose" ? 1.5 : 1.0;
  const base = 15 + h * 120; // 15 on easy … 135 on the hardest
  const jitter = 0.85 + rand() * 0.3;
  return Math.max(5, Math.min(160, Math.round(base * mult * jitter)));
}

/**
 * Resolve every rival's ante for one hand. Deterministic given `handKey`, so client
 * and server agree on the pot. The ante depends only on the first rand() draw, so it
 * matches whether or not `choices` (for pick display) are supplied.
 */
export function resolveBotHands(opts: {
  handKey: string;
  hardness: number;
  choices?: { id: string; correct: boolean }[];
}): BotHandResult[] {
  const { handKey, hardness, choices } = opts;
  const correctId = choices?.find((c) => c.correct)?.id ?? choices?.[0]?.id;
  const wrongIds = choices?.filter((c) => !c.correct).map((c) => c.id) ?? [];

  return POKER_BOTS.map((bot) => {
    const rand = mulberry(hashSeed(`${handKey}:${bot.id}`));
    const bet = botAnte(bot, hardness, rand);
    if (!choices || !correctId) {
      return { botId: bot.id, name: bot.name, color: bot.color, bet };
    }
    const picksCorrect = rand() < bot.skill;
    let choiceId = correctId;
    if (!picksCorrect && wrongIds.length > 0) {
      choiceId = wrongIds[Math.floor(rand() * wrongIds.length)];
    }
    return {
      botId: bot.id,
      name: bot.name,
      color: bot.color,
      bet,
      choiceId,
      correct: choiceId === correctId,
    };
  });
}

/** Total chips the rivals ante into the pot for a hand (the amount you win). */
export function botPot(handKey: string, hardness: number): number {
  return resolveBotHands({ handKey, hardness }).reduce((s, b) => s + b.bet, 0);
}
