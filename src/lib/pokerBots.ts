/**
 * Rival bots for poker-table study mode.
 * Each has a skill (P(pick correct)) and a play style for stakes / banter.
 */

export type PokerBotId = "kirissh" | "arnav" | "harshith" | "sai";

export type PokerBot = {
  id: PokerBotId;
  name: string;
  /** Probability they pick the correct MCQ option */
  skill: number;
  /** Preferred stake relative to the table pot sizes */
  aggression: "tight" | "normal" | "loose";
  color: string;
  tagline: string;
};

export const POKER_BOTS: PokerBot[] = [
  {
    id: "kirissh",
    name: "Kirissh",
    skill: 0.78,
    aggression: "normal",
    color: "#8eb4e8",
    tagline: "reads the room",
  },
  {
    id: "arnav",
    name: "Arnav",
    skill: 0.55,
    aggression: "loose",
    color: "#e8c48e",
    tagline: "all-in energy",
  },
  {
    id: "harshith",
    name: "Harshith",
    skill: 0.68,
    aggression: "tight",
    color: "#9ee0c0",
    tagline: "slow & steady",
  },
  {
    id: "sai",
    name: "Sai",
    skill: 0.82,
    aggression: "normal",
    color: "#c9a8f0",
    tagline: "quietly deadly",
  },
];

export type BotHandResult = {
  botId: PokerBotId;
  name: string;
  color: string;
  choiceId: string;
  correct: boolean;
  bet: number;
  delta: number;
  stack: number;
};

export type BotStackState = Record<PokerBotId, number>;

export function initialBotStacks(start = 500): BotStackState {
  return {
    kirissh: start,
    arnav: start,
    harshith: start,
    sai: start,
  };
}

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

function botStake(
  bot: PokerBot,
  userStake: number,
  stack: number,
  rand: () => number
): number {
  const options = [10, 25, 50, 100].filter((s) => s <= stack);
  if (options.length === 0) return 0;
  if (bot.aggression === "tight") {
    return Math.min(stack, options[0] ?? 10);
  }
  if (bot.aggression === "loose") {
    const high = options[options.length - 1] ?? 10;
    return Math.min(stack, rand() > 0.4 ? high : userStake);
  }
  // Prefer matching the player's stake when possible
  if (options.includes(userStake)) return userStake;
  return options[Math.floor(rand() * options.length)] ?? 10;
}

/**
 * Resolve one hand for every bot against the same MCQ choices.
 * Deterministic given `handKey` so refreshes don't reshuffle mid-hand.
 */
export function resolveBotHands(opts: {
  handKey: string;
  choices: { id: string; correct: boolean }[];
  userStake: number;
  stacks: BotStackState;
}): { results: BotHandResult[]; nextStacks: BotStackState } {
  const { handKey, choices, userStake, stacks } = opts;
  const correctId = choices.find((c) => c.correct)?.id ?? choices[0]?.id;
  const wrongIds = choices.filter((c) => !c.correct).map((c) => c.id);
  const nextStacks = { ...stacks };
  const results: BotHandResult[] = [];

  for (const bot of POKER_BOTS) {
    const rand = mulberry(hashSeed(`${handKey}:${bot.id}`));
    const stack = nextStacks[bot.id];
    const bet = botStake(bot, userStake, stack, rand);
    if (bet <= 0 || !correctId) {
      results.push({
        botId: bot.id,
        name: bot.name,
        color: bot.color,
        choiceId: "—",
        correct: false,
        bet: 0,
        delta: 0,
        stack,
      });
      continue;
    }

    const picksCorrect = rand() < bot.skill;
    let choiceId = correctId;
    if (!picksCorrect && wrongIds.length > 0) {
      choiceId = wrongIds[Math.floor(rand() * wrongIds.length)];
    }
    const correct = choiceId === correctId;
    const delta = correct ? bet : -bet;
    const next = Math.max(0, stack + delta);
    nextStacks[bot.id] = next;
    results.push({
      botId: bot.id,
      name: bot.name,
      color: bot.color,
      choiceId,
      correct,
      bet,
      delta,
      stack: next,
    });
  }

  return { results, nextStacks };
}
