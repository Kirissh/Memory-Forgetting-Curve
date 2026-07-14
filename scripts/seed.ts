/**
 * Seed a demo user + biology deck with synthetic review history
 * so the HLR queue and evaluation have something to show.
 *
 *   npx tsx scripts/seed.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import { embed } from "../src/lib/embeddings";
import { PRIOR_WEIGHTS, FEATURE_NAMES } from "../src/lib/types";
import type { Database } from "../src/lib/types";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

const SAMPLE = `
Photosynthesis is the process by which green plants convert light energy into chemical energy.
Chlorophyll absorbs light, primarily in the blue and red wavelengths.
The light-dependent reactions occur in the thylakoid membrane and produce ATP and NADPH.
The Calvin cycle fixes carbon dioxide into glucose in the stroma of the chloroplast.
Mitochondria are the site of cellular respiration, oxidizing glucose to release ATP.
DNA replication is semi-conservative: each strand serves as a template for a new strand.
Enzymes lower activation energy and speed up biochemical reactions without being consumed.
Osmosis is the diffusion of water across a selectively permeable membrane.
`.trim();

const CARDS = [
  {
    concept: "Photosynthesis",
    definition: "Process converting light energy into chemical energy in plants.",
    front: "What is photosynthesis?",
    back: "The conversion of light energy into chemical energy (glucose) by green plants.",
  },
  {
    concept: "Chlorophyll",
    definition: "Pigment that absorbs blue and red light for photosynthesis.",
    front: "What wavelengths does chlorophyll primarily absorb?",
    back: "Blue and red wavelengths.",
  },
  {
    concept: "Light-dependent reactions",
    definition: "Thylakoid reactions producing ATP and NADPH.",
    front: "Where do light-dependent reactions occur, and what do they produce?",
    back: "In the thylakoid membrane; they produce ATP and NADPH.",
  },
  {
    concept: "Calvin cycle",
    definition: "Carbon fixation into glucose in the chloroplast stroma.",
    front: "What does the Calvin cycle do?",
    back: "Fixes CO₂ into glucose in the stroma of the chloroplast.",
  },
  {
    concept: "Mitochondria",
    definition: "Organelles for cellular respiration and ATP release.",
    front: "What is the primary function of mitochondria?",
    back: "Site of cellular respiration — oxidizing glucose to release ATP.",
  },
  {
    concept: "DNA replication",
    definition: "Semi-conservative copying of DNA strands.",
    front: "Why is DNA replication described as semi-conservative?",
    back: "Each strand serves as a template for a new strand, so each daughter duplex has one old and one new strand.",
  },
  {
    concept: "Enzymes",
    definition: "Catalysts that lower activation energy.",
    front: "How do enzymes speed up reactions?",
    back: "They lower activation energy and are not consumed by the reaction.",
  },
  {
    concept: "Osmosis",
    definition: "Diffusion of water across a selectively permeable membrane.",
    front: "What is osmosis?",
    back: "The diffusion of water across a selectively permeable membrane.",
  },
];

async function main() {
  const dataDir = path.join(process.cwd(), ".data");
  await fs.mkdir(dataDir, { recursive: true });

  const userId = uuid();
  const materialId = uuid();
  const chunkId = uuid();
  const emb = await embed(SAMPLE);

  const concepts = [];
  const cards = [];
  const reviews = [];

  const now = Date.now();

  for (let i = 0; i < CARDS.length; i++) {
    const item = CARDS[i];
    const conceptId = uuid();
    const cardId = uuid();
    // Vary history so queue ranking is interesting
    const streak = Math.max(0, 4 - (i % 5));
    const incorrect = i % 3 === 0 ? 2 : i % 2;
    const total = streak + incorrect + 3;
    const daysAgo = 1 + i * 1.4;

    concepts.push({
      id: conceptId,
      materialId,
      chunkId,
      title: item.concept,
      definition: item.definition,
      recallProbability: 0.5,
      halfLifeDays: 3,
      correctStreak: streak,
      incorrectCount: incorrect,
      totalReviews: total,
      avgDaysBetweenReviews: 1.5 + (i % 3) * 0.4,
      lastReviewedAt: new Date(now - daysAgo * 86400000).toISOString(),
      createdAt: new Date(now - 14 * 86400000).toISOString(),
    });

    cards.push({
      id: cardId,
      conceptId,
      materialId,
      front: item.front,
      back: item.back,
      createdAt: new Date().toISOString(),
    });

    // Synthetic review trail
    for (let r = 0; r < total; r++) {
      const daysSince = 0.5 + r * 0.8 + (i % 2) * 0.3;
      reviews.push({
        id: uuid(),
        userId,
        cardId,
        conceptId,
        correct: r >= incorrect,
        daysSinceLastReview: daysSince,
        sessionId: uuid(),
        reviewedAt: new Date(
          now - (total - r) * 86400000 - i * 3600000
        ).toISOString(),
      });
    }
  }

  const db: Database = {
    users: [
      {
        id: userId,
        email: "demo@recall.local",
        name: "Demo Student",
        passwordHash: hashPassword("demo1234"),
        createdAt: new Date().toISOString(),
      },
    ],
    materials: [
      {
        id: materialId,
        userId,
        title: "Cell Biology — Photosynthesis & Metabolism",
        status: "ready",
        sourceType: "text",
        storagePath: null,
        createdAt: new Date().toISOString(),
      },
    ],
    chunks: [
      {
        id: chunkId,
        materialId,
        content: SAMPLE,
        chunkIndex: 0,
        embedding: emb,
      },
    ],
    concepts,
    cards,
    reviews,
    encodings: [],
    modelWeights: [
      {
        id: uuid(),
        userId,
        weights: [...PRIOR_WEIGHTS],
        featureNames: [...FEATURE_NAMES],
        trainedOnReviewCount: 0,
        heldOutLogLoss: null,
        baselineLogLoss: null,
        trainedAt: new Date().toISOString(),
      },
    ],
  };

  await fs.writeFile(
    path.join(dataDir, "db.json"),
    JSON.stringify(db, null, 2)
  );

  console.log("Seeded demo user:");
  console.log("  email:    demo@recall.local");
  console.log("  password: demo1234");
  console.log(`  ${cards.length} cards, ${reviews.length} reviews`);
  console.log("Run the app, open Today's Queue, then end a session to retrain HLR.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
