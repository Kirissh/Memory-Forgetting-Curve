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
import { buildCloze } from "../src/lib/probes";
import { PRIOR_WEIGHTS, FEATURE_NAMES, STARTING_POKER_CREDITS } from "../src/lib/types";
import type { Database } from "../src/lib/types";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

/**
 * Ground truth for the synthetic deck: half-lives are drawn from
 * h = exp(BASE - DIFFICULTY_W·dNorm + STREAK_W·√streak), and each review is a
 * Bernoulli draw from 2^(-Δt/h). Note the √: the trainer's feature is the raw
 * streak, so the model is deliberately *misspecified* against this generator, the
 * way any model is against a real learner. Don't expect the weights to match these
 * constants — `npm run verify:mle` covers estimator correctness on matched data.
 *
 * These deliberately sit well away from PRIOR_WEIGHTS (bias log 3.0, streak 0.35,
 * difficulty -0.22). A demo learner who happens to match the hand-tuned prior gives
 * personalization nothing to find — training could only add variance, and the honest
 * result would be "don't train." This student remembers better than average (base
 * ~10d), gains more per successful recall, and is hit much harder by hard material —
 * which is exactly the deviation HLR exists to pick up. The wide difficulty spread
 * (easy slides hold for weeks, hard ones fade in days) gives a realistic mix of
 * safe / fading / faded cards rather than a uniformly-struggling learner.
 */
const TRUE_BASE_LOG_H = Math.log(10.0);
const TRUE_DIFFICULTY_W = 2.0;
const TRUE_STREAK_W = 0.75;
// Study habits (latent per card, decorrelated from difficulty) that also move the true
// half-life. The trainer never sees the traits — only the night_study_rate /
// massed_practice_rate / study_routine the timestamps and gaps imply.
const TRUE_NIGHT_W = 0.9; // late-night studying shortens the trace
const TRUE_MASS_W = 1.0; // cramming same-day shortens it more
const TRUE_ROUTINE_W = 0.5; // a steady study hour lengthens it a little

// Fixed stream so re-seeding reproduces the same deck.
let rngState = 20260715;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}

/** Deterministic per-card latent trait in [0,1], independent of the rand() stream and
 *  of eol; distinct salts give decorrelated traits (hash-noise, not the RNG). */
function habit(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Standard normal via Box–Muller on the seeded stream — jitter for study hours. */
function gauss(): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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
Ribosomes synthesize proteins by translating messenger RNA into chains of amino acids.
The Golgi apparatus modifies, sorts, and packages proteins for secretion or delivery.
The cell membrane is a selectively permeable phospholipid bilayer controlling transport.
Active transport moves molecules against their concentration gradient using ATP energy.
Transcription copies a gene from DNA into messenger RNA inside the nucleus.
Translation reads messenger RNA codons at the ribosome to assemble a protein.
Meiosis produces four genetically distinct haploid gametes from one diploid cell.
Cellular respiration oxidizes glucose through glycolysis, the Krebs cycle, and the electron transport chain.
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
  {
    concept: "Ribosomes",
    definition: "Organelles that synthesize proteins by translating messenger RNA.",
    front: "What do ribosomes do?",
    back: "They synthesize proteins by translating messenger RNA into amino-acid chains.",
  },
  {
    concept: "Golgi apparatus",
    definition: "Organelle that modifies, sorts, and packages proteins for delivery.",
    front: "What is the role of the Golgi apparatus?",
    back: "It modifies, sorts, and packages proteins for secretion or delivery.",
  },
  {
    concept: "Cell membrane",
    definition: "Selectively permeable phospholipid bilayer controlling transport.",
    front: "What is the cell membrane made of, and what does it do?",
    back: "A selectively permeable phospholipid bilayer that controls what enters and leaves the cell.",
  },
  {
    concept: "Active transport",
    definition: "Movement of molecules against their gradient using ATP energy.",
    front: "How does active transport differ from diffusion?",
    back: "It moves molecules against their concentration gradient and requires ATP energy.",
  },
  {
    concept: "Transcription",
    definition: "Copying a gene from DNA into messenger RNA in the nucleus.",
    front: "What happens during transcription?",
    back: "A gene is copied from DNA into messenger RNA inside the nucleus.",
  },
  {
    concept: "Translation",
    definition: "Reading messenger RNA codons at the ribosome to build a protein.",
    front: "What happens during translation?",
    back: "Ribosomes read messenger RNA codons to assemble a protein from amino acids.",
  },
  {
    concept: "Meiosis",
    definition: "Division producing four haploid gametes from one diploid cell.",
    front: "What does meiosis produce?",
    back: "Four genetically distinct haploid gametes from a single diploid cell.",
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
  const DAY = 86400000;

  for (let i = 0; i < CARDS.length; i++) {
    const item = CARDS[i];
    const conceptId = uuid();
    const cardId = uuid();

    // Latent traits the trainer is supposed to *infer*. It never sees these —
    // it only sees the outcomes, timestamps, and gaps they produce.
    const eol = 1 + (i % 5); // ease-of-learning judgment, 1–5
    const dNorm = (eol - 1) / 4;
    const nightTrait = habit(i, 11); // 0 daytime … 1 night owl
    const routineTrait = habit(i, 29); // 0 scattered hours … 1 same time daily
    const massTrait = habit(i, 47); // 0 spaces reviews … 1 crams same-day
    const trueLogH0 =
      TRUE_BASE_LOG_H -
      TRUE_DIFFICULTY_W * dNorm -
      TRUE_NIGHT_W * nightTrait -
      TRUE_MASS_W * massTrait +
      TRUE_ROUTINE_W * routineTrait +
      (rand() - 0.5) * 0.3;

    const nReviews = 14 + (i % 5); // 14..18 — ~250 reviews total, bigger honest holdout

    // This card's clock profile: when in the day it's studied, and how tightly.
    const muHour = 14 - 13 * nightTrait; // 14:00 (day) … 01:00 (night)
    const sigmaHours = 0.4 + (1 - routineTrait) * 5.5; // tight … scattered

    // One forward pass on a whole-day calendar, drawing each outcome from the true curve.
    // Successes lengthen the half-life through √streak: a raw-count exponent compounds
    // without bound (h in the hundreds of days by the fifth hit), every later answer is
    // trivially right, and the deck stops carrying information. √ is also the form
    // Settles & Meeder use. Spaced reviews use a generic expanding schedule that does
    // NOT know this learner's true h; crammers fold in same-day repeats; everyone lands
    // each review at their circadian hour, so the three habit features carry real signal.
    const recs: { ms: number; gap: number; correct: boolean; p: number }[] = [];
    let streak = 0;
    let dayCursor = 0;
    let prevMs = -Infinity;
    for (let r = 0; r < nReviews; r++) {
      const h = Math.exp(trueLogH0 + TRUE_STREAK_W * Math.sqrt(streak));
      const cram = r > 0 && rand() < 0.6 * massTrait;
      if (r > 0 && !cram) {
        // Whole-day gaps (≥ 2) so hour jitter can never turn a spaced review into a
        // false same-day cram.
        dayCursor += Math.max(
          2,
          Math.round(Math.min(0.9 + r * 0.9, 10) + rand() * 0.6)
        );
      }
      let ms: number;
      if (cram) {
        ms = prevMs + (0.5 + rand() * 4) * 3600000; // same-day repeat, a few hours later
      } else {
        let hour = muHour + gauss() * sigmaHours;
        hour = ((hour % 24) + 24) % 24;
        ms = dayCursor * DAY + hour * 3600000;
        if (ms <= prevMs) ms += DAY; // safety: keep the trail strictly increasing
      }
      const gap = prevMs === -Infinity ? 0.5 : (ms - prevMs) / DAY;
      prevMs = ms;
      const p = Math.pow(2, -gap / h);
      const correct = rand() < p;
      recs.push({ ms, gap, correct, p });
      if (correct) streak += 1;
      else streak = 0;
    }

    // Stagger recency by a whole number of days so the circadian hours survive the shift:
    // some cards overdue, some fresh.
    const daysAgoLast = 1 + Math.round(i * 1.3);
    const nowMidnight = Math.floor(now / DAY) * DAY;
    const spanEndDayMs = Math.floor(recs[recs.length - 1].ms / DAY) * DAY;
    const shift = nowMidnight - daysAgoLast * DAY - spanEndDayMs; // whole-day multiple
    const firstAt = recs[0].ms + shift;

    // Materialize, accumulating state exactly as POST /api/reviews would, so the concept
    // row below is the true end state of this trail.
    let incorrect = 0;
    let total = 0;
    let avgGap = 0;
    let avgRead: number | undefined;
    let avgResp: number | undefined;
    let lastAt: number | null = null;
    streak = 0;

    for (const e of recs) {
      const t = e.ms + shift;
      const readMs = Math.round(4000 + rand() * 6000);
      // Slow retrieval tracks a weak trace: partly a standing trait of hard material,
      // partly how faded it is right now, and mostly noise. Making it a near-clean
      // function of p instead would leave it collinear with everything driving p, and
      // the fit would split one effect across two uninterpretable weights.
      const respMs = Math.round(
        1100 + 1800 * dNorm + 1400 * (1 - e.p) + rand() * 1800
      );

      reviews.push({
        id: uuid(),
        userId,
        cardId,
        conceptId,
        correct: e.correct,
        daysSinceLastReview: Number(e.gap.toFixed(3)),
        sessionId: uuid(),
        reviewedAt: new Date(t).toISOString(),
        readTimeMs: readMs,
        responseTimeMs: respMs,
        difficulty: eol,
      });

      total += 1;
      if (e.correct) streak += 1;
      else {
        streak = 0;
        incorrect += 1;
      }
      avgRead = ((avgRead || readMs) * (total - 1) + readMs) / total;
      avgResp = ((avgResp || respMs) * (total - 1) + respMs) / total;
      if (lastAt != null) {
        const g = (t - lastAt) / DAY;
        avgGap = ((avgGap || g) * (total - 1) + g) / total;
      }
      lastAt = t;
    }

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
      avgDaysBetweenReviews: Number(avgGap.toFixed(3)),
      lastReviewedAt: new Date(lastAt!).toISOString(),
      createdAt: new Date(firstAt - DAY).toISOString(),
      avgReadTimeMs: Math.round(avgRead!),
      avgResponseTimeMs: Math.round(avgResp!),
      avgDifficulty: eol,
    });

    const cloze = buildCloze(item.definition);
    cards.push({
      id: cardId,
      conceptId,
      materialId,
      front: item.front,
      back: item.back,
      clozeText: cloze?.clozeText,
      clozeAnswer: cloze?.clozeAnswer,
      createdAt: new Date().toISOString(),
    });
  }

  const db: Database = {
    users: [
      {
        id: userId,
        email: "demo@recall.local",
        name: "Demo Student",
        passwordHash: hashPassword("demo1234"),
        createdAt: new Date().toISOString(),
        pokerCredits: STARTING_POKER_CREDITS,
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

  // Train the model + populate the head-to-head comparison and per-card FSRS state
  // up front, so Insights, the curve band, and the schedule have data on first load.
  const { retrainUserModel } = await import("../src/lib/hlr");
  const model = await retrainUserModel(userId);

  console.log("Seeded demo user:");
  console.log("  email:    demo@recall.local");
  console.log("  password: demo1234");
  console.log(`  ${cards.length} cards, ${reviews.length} reviews`);
  if (model.comparison) {
    console.log("Held-out model comparison:");
    for (const m of model.comparison) {
      console.log(
        `  ${m.name.padEnd(20)} log-loss ${m.logLoss.toFixed(4)}  acc ${(
          m.accuracy * 100
        ).toFixed(0)}%  (n=${m.n})`
      );
    }
  }
  console.log("Open Today's Queue · Curve · Schedule · Insights.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
