/**
 * Held-out evaluation of the trained HLR, and a head-to-head against the cold-start
 * prior, classic SM-2, and a per-card FSRS model.
 *
 *   npx tsx scripts/eval-hlr.ts
 *
 * All numbers are held-out means. Log-loss / Brier / ECE are lower-is-better; a
 * coin-flip scores log-loss ln(2) ≈ 0.693. A log-loss near zero on human recall
 * means something is leaking, not that the model is good.
 */
import { readDb } from "../src/lib/db";
import {
  PRIOR_WEIGHTS,
  FEATURE_NAMES,
} from "../src/lib/retention";
import { retrainUserModel } from "../src/lib/hlr";

async function main() {
  const db = await readDb();
  const user = db.users[0];
  if (!user) {
    console.log("No users — run npm run seed first");
    return;
  }

  const model = await retrainUserModel(user.id);
  const n = db.reviews.filter((r) => r.userId === user.id).length;

  console.log(`Reviews in history:        ${n}`);
  console.log(`Trained on:                ${model.trainedOnReviewCount}`);
  console.log(`Held-out HLR log-loss:     ${fmt(model.heldOutLogLoss)}`);
  console.log(`Held-out prior log-loss:   ${fmt(model.baselineLogLoss)}`);
  console.log(`Coin-flip baseline:        ${Math.LN2.toFixed(4)}`);

  if (model.heldOutLogLoss != null && model.baselineLogLoss != null) {
    const pct =
      ((model.baselineLogLoss - model.heldOutLogLoss) / model.baselineLogLoss) *
      100;
    console.log(`Reduction vs prior:        ${pct.toFixed(1)}%`);
    if (model.heldOutLogLoss < 0.05) {
      console.log(
        "\n  ⚠  Log-loss this low on human recall almost always means leakage,\n" +
          "     not skill. Check that no feature encodes the outcome or the lag."
      );
    }
  }

  if (model.comparison?.length) {
    console.log("\n=== Held-out model comparison ===");
    console.log(
      "  " +
        "model".padEnd(20) +
        "logloss".padStart(9) +
        "brier".padStart(9) +
        "ece".padStart(9) +
        "acc".padStart(7) +
        "n".padStart(6)
    );
    for (const m of model.comparison) {
      console.log(
        "  " +
          m.name.padEnd(20) +
          m.logLoss.toFixed(4).padStart(9) +
          m.brier.toFixed(4).padStart(9) +
          m.ece.toFixed(4).padStart(9) +
          `${(m.accuracy * 100).toFixed(0)}%`.padStart(7) +
          String(m.n).padStart(6)
      );
    }
  }

  if (model.calibrationBins?.length) {
    console.log("\n=== HLR reliability (predicted → observed) ===");
    for (const b of model.calibrationBins) {
      const bar = "█".repeat(Math.round(b.empiricalRate * 20));
      console.log(
        `  ${(b.predictedMean * 100).toFixed(0).padStart(3)}% → ${(
          b.empiricalRate * 100
        )
          .toFixed(0)
          .padStart(3)}%  n=${String(b.count).padStart(3)}  ${bar}`
      );
    }
  }

  console.log("\nLearned weights (log-days per unit feature):");
  const w = model.weights;
  FEATURE_NAMES.forEach((name, i) => {
    const delta = w[i] - PRIOR_WEIGHTS[i];
    const sign = delta >= 0 ? "+" : "";
    console.log(
      `  ${name.padEnd(30)}${w[i].toFixed(4).padStart(9)}   (prior ${PRIOR_WEIGHTS[i].toFixed(2).padStart(6)}, ${sign}${delta.toFixed(3)})`
    );
  });

  if (model.fsrsParams) {
    console.log(
      `\nFSRS fitted init stabilities: ${model.fsrsParams
        .slice(0, 4)
        .map((x) => x.toFixed(2))
        .join(", ")}   growth exp(w8)=${Math.exp(model.fsrsParams[8]).toFixed(2)}`
    );
  }
}

function fmt(v: number | null): string {
  return v == null ? "n/a" : v.toFixed(4);
}

main().catch(console.error);
