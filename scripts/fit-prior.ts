/**
 * Fit a DATA-DRIVEN cold-start prior for HLR.
 *
 * The PRIOR_WEIGHTS in types.ts are hand-tuned guesses. Ideally the prior is fit on a
 * large public corpus — e.g. the Duolingo half-life dataset (Settles & Meeder, ACL
 * 2016). That dataset isn't bundled here, so this script fits on a SYNTHETIC population
 * of learners with varied latent traits: a faithful stand-in that exercises the exact
 * pipeline you'd run on real logs. To productionize, replace `generatePopulation` with a
 * loader over real review logs and keep everything else.
 *
 *   npx tsx scripts/fit-prior.ts
 *
 * Writes ml/artifacts/prior_weights.json and reports whether the fitted prior beats the
 * hand-tuned one on held-out learners.
 */
import { promises as fs } from "fs";
import path from "path";
import {
  fitHalfLifeMLE,
  meanNegLogLik,
  PRIOR_WEIGHTS,
  FEATURE_NAMES,
  type TrainingRow,
} from "../src/lib/retention";

const D = FEATURE_NAMES.length;

// Fixed stream so the fit reproduces exactly.
let seed = 20260719;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
/** Standard normal via Box–Muller. */
function randn(): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// The population "truth" the synthetic learners follow — unknown to the fitter, and
// deliberately not equal to the hand-tuned prior so there is something real to learn.
const TRUE = [
  Math.log(4.5), // bias → ~4.5d half-life
  0.42, // correct_streak
  -0.3, // incorrect_count
  0.18, // log_total_reviews
  0.06, // avg_days_between_reviews
  0.12, // concept_embedding_similarity
  0.05, // log_read_time
  -0.2, // log_response_time
  -0.4, // trap_fail_rate
  -0.28, // difficulty
];

/** A population of learners, each deviating around TRUE, drawing Bernoulli recalls. */
function generatePopulation(nLearners: number, perLearner: number): TrainingRow[] {
  const rows: TrainingRow[] = [];
  for (let l = 0; l < nLearners; l++) {
    const w = TRUE.map((t, j) => (j === 0 ? t : t + randn() * 0.15));
    for (let i = 0; i < perLearner; i++) {
      const x = [1];
      for (let j = 1; j < D; j++) x.push(randn() * 0.8 + (j === 3 ? 1 : 0));
      let z = 0;
      for (let j = 0; j < D; j++) z += w[j] * x[j];
      const h = Math.exp(Math.min(Math.max(z, -5), 8));
      const dt = 0.2 + rand() * 14;
      const p = Math.pow(2, -dt / h);
      rows.push({ features: x, deltaTDays: dt, correct: rand() < p });
    }
  }
  return rows;
}

async function main() {
  const train = generatePopulation(200, 40);
  const val = generatePopulation(60, 40);
  console.log(
    `Synthetic population: ${train.length} train rows, ${val.length} val rows`
  );

  // Fit toward 0 with a weak L2 — there is no informative prior to lean on here.
  const fitted = fitHalfLifeMLE(train, new Array(D).fill(0), {
    l2: 1,
    iters: 1200,
    lr: 0.03,
  });

  const llHand = meanNegLogLik(val, PRIOR_WEIGHTS);
  const llFit = meanNegLogLik(val, fitted);
  const llTrue = meanNegLogLik(val, TRUE);

  console.log("\nHeld-out log-loss on validation learners:");
  console.log(`  hand-tuned prior : ${llHand.toFixed(4)}`);
  console.log(`  fitted prior     : ${llFit.toFixed(4)}`);
  console.log(`  population truth  : ${llTrue.toFixed(4)}  (unbeatable floor)`);

  console.log("\nFitted prior vs hand-tuned:");
  FEATURE_NAMES.forEach((name, i) => {
    console.log(
      `  ${name.padEnd(30)} fit ${fitted[i].toFixed(3).padStart(8)}   hand ${PRIOR_WEIGHTS[i].toFixed(2).padStart(6)}`
    );
  });

  const outDir = path.join(process.cwd(), "ml", "artifacts");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "prior_weights.json");
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        featureNames: FEATURE_NAMES,
        fitted,
        handTuned: PRIOR_WEIGHTS,
        valLogLoss: { handTuned: llHand, fitted: llFit, truth: llTrue },
        note: "Fitted on a synthetic learner population; swap generatePopulation for a real-log loader to productionize.",
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);
  console.log(
    llFit < llHand
      ? "Fitted prior beats the hand-tuned prior on held-out data — paste `fitted` into PRIOR_WEIGHTS to adopt it."
      : "Hand-tuned prior holds up on this population — keeping it is defensible."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
