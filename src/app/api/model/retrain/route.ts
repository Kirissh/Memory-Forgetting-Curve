import { getCurrentUser } from "@/lib/auth";
import { retrainUserModel } from "@/lib/hlr";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const model = await retrainUserModel(user.id);
    return jsonOk({
      weights: model.weights,
      featureNames: model.featureNames,
      trainedOnReviewCount: model.trainedOnReviewCount,
      heldOutLogLoss: model.heldOutLogLoss,
      baselineLogLoss: model.baselineLogLoss,
      trainedAt: model.trainedAt,
      improvement:
        model.heldOutLogLoss != null && model.baselineLogLoss != null
          ? {
              logLossReductionPct:
                ((model.baselineLogLoss - model.heldOutLogLoss) /
                  model.baselineLogLoss) *
                100,
            }
          : null,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Retrain failed", 500);
  }
}
