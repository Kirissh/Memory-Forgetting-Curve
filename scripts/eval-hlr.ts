/**
 * Held-out log-loss: trained HLR vs fixed prior heuristic.
 * Run after seed + at least one retrain, or it trains inline.
 *
 *   npx tsx scripts/eval-hlr.ts
 */
import { readDb } from "../src/lib/db";
import {
  PRIOR_WEIGHTS,
  buildFeatures,
  fitRidge,
  observedHalfLife,
  predictHalfLife,
  predictRecall,
  logLoss,
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
  console.log("Trained on", model.trainedOnReviewCount, "reviews");
  console.log("Held-out HLR log-loss:     ", model.heldOutLogLoss);
  console.log("Held-out prior log-loss:   ", model.baselineLogLoss);
  if (model.heldOutLogLoss != null && model.baselineLogLoss != null) {
    const pct =
      ((model.baselineLogLoss - model.heldOutLogLoss) / model.baselineLogLoss) *
      100;
    console.log(`Log-loss reduction vs prior: ${pct.toFixed(1)}%`);
  }

  // Sanity: also show ridge fit size
  const reviews = db.reviews.filter((r) => r.userId === user.id);
  const X = reviews.map((r) => {
    const c = db.concepts.find((x) => x.id === r.conceptId)!;
    return buildFeatures({
      correctStreak: c.correctStreak,
      incorrectCount: c.incorrectCount,
      totalReviews: c.totalReviews,
      avgDaysBetweenReviews: c.avgDaysBetweenReviews,
      daysSinceLastReview: r.daysSinceLastReview,
      conceptEmbeddingSimilarity: 0,
    });
  });
  const y = reviews.map((r) =>
    Math.log(observedHalfLife(Math.max(r.daysSinceLastReview, 0.1), r.correct))
  );
  if (X.length >= 5) {
    const w = fitRidge(X, y, 1.0);
    console.log(
      "Sample predictRecall(h=3, Δt=3):",
      predictRecall(3, 3).toFixed(3)
    );
    console.log(
      "Sample half-life from weights:",
      predictHalfLife(w.length ? w : PRIOR_WEIGHTS, X[0]).toFixed(2),
      "days"
    );
  }
}

main().catch(console.error);
