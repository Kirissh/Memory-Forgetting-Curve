/**
 * Held-out log-loss: trained HLR vs the fixed cold-start prior.
 *
 *   npx tsx scripts/eval-hlr.ts
 *
 * Both numbers are mean negative log-likelihood per review under
 * P = 2^(-Δt/h) — lower is better, and ln(2) ≈ 0.693 is what you'd score by
 * predicting 50% for everything. A reduction of a few percent is a real result;
 * anything near zero loss means something is leaking, not that the model is good.
 */
import { readDb } from "../src/lib/db";
import { PRIOR_WEIGHTS, FEATURE_NAMES, predictHalfLife } from "../src/lib/retention";
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

  console.log("\nLearned weights (log-days per unit feature):");
  const w = model.weights;
  FEATURE_NAMES.forEach((name, i) => {
    const delta = w[i] - PRIOR_WEIGHTS[i];
    const sign = delta >= 0 ? "+" : "";
    console.log(
      `  ${name.padEnd(30)}${w[i].toFixed(4).padStart(9)}   (prior ${PRIOR_WEIGHTS[i].toFixed(2).padStart(6)}, ${sign}${delta.toFixed(3)})`
    );
  });

  const h = predictHalfLife(w, [1, 3, 0, Math.log1p(3), 2, 0, Math.log1p(8), Math.log1p(4), 0, 0.5]);
  console.log(
    `\nExample: 3-hit streak, no misses, 3 reviews  →  h = ${h.toFixed(2)} days`
  );
}

function fmt(v: number | null): string {
  return v == null ? "n/a" : v.toFixed(4);
}

main().catch(console.error);
