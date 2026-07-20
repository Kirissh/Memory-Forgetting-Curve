/**
 * Does the new MLE fitter actually estimate what it claims?
 *   npx tsx <this file>
 */
import {
  fitHalfLifeMLE,
  meanNegLogLik,
  type TrainingRow,
} from "../src/lib/retention";

// Deterministic RNG so the test doesn't flake.
let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

const D = 10;

function synth(trueW: number[], n: number): TrainingRow[] {
  const rows: TrainingRow[] = [];
  for (let i = 0; i < n; i++) {
    const x = [1];
    for (let j = 1; j < D; j++) x.push(rand() * 2 - 1); // features in [-1,1]
    let z = 0;
    for (let j = 0; j < D; j++) z += trueW[j] * x[j];
    const h = Math.exp(z);
    const deltaTDays = 0.1 + rand() * 20;
    const p = Math.pow(2, -deltaTDays / h);
    rows.push({ features: x, deltaTDays, correct: rand() < p });
  }
  return rows;
}

console.log("=== 1. Parameter recovery from synthetic data ===");
console.log("   (generate from a known w, fit, see if we get it back)\n");

const trueW = [
  Math.log(5), 0.6, -0.5, 0.3, 0.1, 0.2, -0.15, -0.4, 0.25, -0.3,
];
const train = synth(trueW, 8000);
// Start from a deliberately WRONG prior — recovery must come from the data.
const wrongPrior = Array(D).fill(0);
const fitted = fitHalfLifeMLE(train, wrongPrior, { iters: 1500, lr: 0.03 });

let maxErr = 0;
console.log("   idx   true      fitted    err");
for (let j = 0; j < D; j++) {
  const err = Math.abs(fitted[j] - trueW[j]);
  maxErr = Math.max(maxErr, err);
  console.log(
    `   ${String(j).padStart(2)}   ${trueW[j].toFixed(3).padStart(7)}   ${fitted[j].toFixed(3).padStart(7)}   ${err.toFixed(3)}`
  );
}
console.log(`\n   max abs error: ${maxErr.toFixed(4)}  ->  ${maxErr < 0.12 ? "RECOVERED" : "FAILED"}`);

console.log("\n=== 2. Is the fit actually at an optimum? ===");
const nllFit = meanNegLogLik(train, fitted);
const nllTrue = meanNegLogLik(train, trueW);
const nllPrior = meanNegLogLik(train, wrongPrior);
console.log(`   NLL @ fitted w : ${nllFit.toFixed(5)}`);
console.log(`   NLL @ true   w : ${nllTrue.toFixed(5)}   (fit should be <= true + noise)`);
console.log(`   NLL @ wrong  w : ${nllPrior.toFixed(5)}   (start point)`);

let worseCount = 0;
for (let j = 0; j < D; j++) {
  for (const eps of [-0.05, 0.05]) {
    const pert = [...fitted];
    pert[j] += eps;
    if (meanNegLogLik(train, pert) > nllFit) worseCount++;
  }
}
console.log(
  `   perturbations that made it worse: ${worseCount}/${D * 2}  ->  ${worseCount === D * 2 ? "LOCAL OPTIMUM" : "NOT converged"}`
);

console.log("\n=== 3. Leakage probe: fit on SHUFFLED outcomes ===");
console.log("   A leak-free model can't beat chance on randomized labels.\n");
const shuffled = train.map((r) => ({ ...r }));
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  const t = shuffled[i].correct;
  shuffled[i].correct = shuffled[j].correct;
  shuffled[j].correct = t;
}
const cut = Math.floor(shuffled.length * 0.85);
const sFit = fitHalfLifeMLE(shuffled.slice(0, cut), wrongPrior, { iters: 800 });
const sHeld = meanNegLogLik(shuffled.slice(cut), sFit);
const baseRate =
  shuffled.slice(cut).filter((r) => r.correct).length / (shuffled.length - cut);
const entropy = -(
  baseRate * Math.log(baseRate) +
  (1 - baseRate) * Math.log(1 - baseRate)
);
console.log(`   held-out NLL on shuffled labels: ${sHeld.toFixed(4)}`);
console.log(`   base-rate entropy (can't beat) : ${entropy.toFixed(4)}`);
console.log(
  `   -> ${sHeld >= entropy - 0.02 ? "NO LEAK (can't beat the base rate)" : "LEAK: predicts noise"}`
);
