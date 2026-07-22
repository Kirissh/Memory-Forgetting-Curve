/**
 * Brain Frames — cosmetic rings you buy with Recall Brains and wear around your
 * avatar. Pure data (no canvas/DOM) so both the server (pricing, ownership) and the
 * client (rendering) can import it. The `stops`/`style`/`glow` fields drive one
 * shared canvas renderer, so what you preview is exactly what downloads.
 */

export type FrameRarity = "common" | "rare" | "epic" | "legendary";

export type Frame = {
  id: string;
  name: string;
  blurb: string;
  price: number;
  rarity: FrameRarity;
  /** How the ring is painted from `stops`. */
  style: "solid" | "linear" | "conic" | "double";
  /** Gradient colour stops, evenly spaced. */
  stops: string[];
  /** Optional outer glow colour. */
  glow?: string;
  /** Slowly rotate the ring (conic frames read best animated). */
  animated?: boolean;
};

export const FRAMES: Frame[] = [
  {
    id: "hairline",
    name: "Hairline",
    blurb: "a clean, quiet ring",
    price: 40,
    rarity: "common",
    style: "solid",
    stops: ["#8ea2c0"],
  },
  {
    id: "goldleaf",
    name: "Gold Leaf",
    blurb: "old-money shine",
    price: 150,
    rarity: "common",
    style: "linear",
    stops: ["#f7e08a", "#c9a227", "#f7e08a"],
  },
  {
    id: "neondrip",
    name: "Neon Drip",
    blurb: "pink & cyan, wet look",
    price: 400,
    rarity: "rare",
    style: "conic",
    stops: ["#ff5cf0", "#5cf0ff", "#ff5cf0"],
    glow: "#ff5cf0",
    animated: true,
  },
  {
    id: "molten",
    name: "Molten",
    blurb: "poured straight from the forge",
    price: 650,
    rarity: "rare",
    style: "linear",
    stops: ["#ffd36e", "#ff5e3a", "#b31217"],
    glow: "#ff5e3a",
  },
  {
    id: "aurora",
    name: "Aurora",
    blurb: "northern-lights sweep",
    price: 1200,
    rarity: "epic",
    style: "conic",
    stops: ["#7af0c8", "#8ea2ff", "#c98eff", "#7af0c8"],
    glow: "#8ea2ff",
    animated: true,
  },
  {
    id: "frostbite",
    name: "Frostbite",
    blurb: "double ring of ice",
    price: 1600,
    rarity: "epic",
    style: "double",
    stops: ["#bfe9ff", "#5aa0d6"],
    glow: "#bfe9ff",
  },
  {
    id: "void",
    name: "Void",
    blurb: "iridescent event horizon",
    price: 3000,
    rarity: "legendary",
    style: "conic",
    stops: ["#20112e", "#3a1d5e", "#7a3ff0", "#20112e"],
    glow: "#7a3ff0",
    animated: true,
  },
  {
    id: "galaxybrain",
    name: "Galaxy Brain",
    blurb: "the whole spectrum, humming",
    price: 6000,
    rarity: "legendary",
    style: "conic",
    stops: ["#ff5cf0", "#ffd36e", "#5cf0ff", "#8affc1", "#ff5cf0"],
    glow: "#8ea2ff",
    animated: true,
  },
];

export function getFrame(id?: string | null): Frame | null {
  if (!id) return null;
  return FRAMES.find((f) => f.id === id) ?? null;
}

export const RARITY_LABEL: Record<FrameRarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const RARITY_COLOR: Record<FrameRarity, string> = {
  common: "#8ea2c0",
  rare: "#5cf0ff",
  epic: "#c98eff",
  legendary: "#ffd36e",
};
