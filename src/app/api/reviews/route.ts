import { v4 as uuid } from "uuid";
import { getCurrentUser } from "@/lib/auth";
import { readDb, updateDb } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";
import { daysBetween } from "@/lib/retention";
import {
  retrainUserModel,
  advanceFsrsState,
  fsrsGradeFromReview,
  behaviorAggregates,
} from "@/lib/hlr";
import { recordActivity, type BrainsSummary } from "@/lib/brains";
import { BRAINS_PER_CORRECT } from "@/lib/types";
import type { Review, User } from "@/lib/types";

// Poker stakes are capped in the UI at 100; the server enforces the same ceiling so
// a forged betAmount can't credit more than one legitimate hand.
const MAX_POKER_STAKE = 100;

// Keep the per-session earnings map bounded (abandoned sessions never claim a bonus).
function pruneSessionStudy(u: User) {
  const s = u.sessionStudy;
  if (!s) return;
  const keys = Object.keys(s);
  if (keys.length > 40) for (const k of keys.slice(0, keys.length - 20)) delete s[k];
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json();
    const {
      cardId,
      sessionId,
      readTimeMs,
      responseTimeMs,
      probeWasSameMeaning,
      userSaidSameMeaning,
      difficulty,
      betAmount,
    } = body as {
      cardId: string;
      sessionId?: string;
      readTimeMs?: number;
      responseTimeMs?: number;
      probeWasSameMeaning?: boolean;
      userSaidSameMeaning?: boolean;
      difficulty?: number;
      correct?: boolean;
      betAmount?: number;
    };

    if (!cardId) return jsonError("cardId required");

    let correct: boolean;
    let trapFailed = false;

    if (
      typeof probeWasSameMeaning === "boolean" &&
      typeof userSaidSameMeaning === "boolean"
    ) {
      correct = userSaidSameMeaning === probeWasSameMeaning;
      trapFailed = !probeWasSameMeaning && userSaidSameMeaning === true;
    } else if (typeof body.correct === "boolean") {
      correct = body.correct;
    } else {
      return jsonError(
        "Provide probeWasSameMeaning + userSaidSameMeaning (or legacy correct)"
      );
    }

    const db = await readDb();
    const card = db.cards.find((c) => c.id === cardId);
    if (!card) return jsonError("Card not found", 404);
    const material = db.materials.find((m) => m.id === card.materialId);
    if (!material || material.userId !== user.id) {
      return jsonError("Forbidden", 403);
    }

    const concept = db.concepts.find((c) => c.id === card.conceptId);
    if (!concept) return jsonError("Concept not found", 404);

    const now = new Date().toISOString();
    const daysSince = concept.lastReviewedAt
      ? daysBetween(concept.lastReviewedAt, now)
      : 0;

    const readMs = Math.max(0, Number(readTimeMs) || 0);
    const respMs = Math.max(0, Number(responseTimeMs) || 0);

    // Poker hands are tracked by hand + net stake; study by correct answers.
    // The wager is derived SERVER-side (clamped stake, sign from correctness) — the
    // client's chipDelta is never trusted, so it can't mint arbitrary Brains.
    const isPoker = typeof betAmount === "number" && betAmount > 0;
    const safeBet = isPoker
      ? Math.min(MAX_POKER_STAKE, Math.max(0, Math.round(betAmount!)))
      : 0;
    const pokerNet = isPoker ? (correct ? safeBet : -safeBet) : 0;
    const activityDelta = isPoker
      ? { pokerHands: 1, pokerNet }
      : { correctCards: correct ? 1 : 0 };
    const sid = sessionId || uuid();

    let brains: BrainsSummary | undefined;

    await updateDb((d) => {
      // Re-find inside the locked mutation — a concurrent delete could have removed
      // it between the earlier read and here; skip rather than throw a 500.
      const c = d.concepts.find((x) => x.id === concept.id);
      if (!c) return;
      d.reviews.push({
        id: uuid(),
        userId: user.id,
        cardId,
        conceptId: c.id,
        correct,
        daysSinceLastReview: daysSince,
        sessionId: sid,
        reviewedAt: now,
        readTimeMs: readMs || undefined,
        responseTimeMs: respMs || undefined,
        probeWasSameMeaning:
          typeof probeWasSameMeaning === "boolean"
            ? probeWasSameMeaning
            : undefined,
        userSaidSameMeaning:
          typeof userSaidSameMeaning === "boolean"
            ? userSaidSameMeaning
            : undefined,
        trapFailed: trapFailed || undefined,
        difficulty:
          typeof difficulty === "number"
            ? difficulty
            : concept.avgDifficulty,
        betAmount: isPoker ? safeBet : undefined,
        chipDelta: isPoker ? pokerNet : undefined,
      });

      c.totalReviews += 1;
      if (correct) {
        c.correctStreak += 1;
      } else {
        c.correctStreak = 0;
        c.incorrectCount += 1;
      }

      if (readMs > 0) {
        const n = c.totalReviews;
        c.avgReadTimeMs =
          ((c.avgReadTimeMs || readMs) * (n - 1) + readMs) / n;
      }
      if (respMs > 0) {
        const n = c.totalReviews;
        c.avgResponseTimeMs =
          ((c.avgResponseTimeMs || respMs) * (n - 1) + respMs) / n;
      }

      if (typeof probeWasSameMeaning === "boolean" && !probeWasSameMeaning) {
        c.trapExposures = (c.trapExposures || 0) + 1;
        if (trapFailed) c.trapFails = (c.trapFails || 0) + 1;
        c.trapFailRate = (c.trapFails || 0) / Math.max(c.trapExposures || 1, 1);
      }

      if (c.lastReviewedAt) {
        const gap = daysBetween(c.lastReviewedAt, now);
        const n = c.totalReviews;
        c.avgDaysBetweenReviews =
          ((c.avgDaysBetweenReviews || gap) * (n - 1) + gap) / n;
      }

      // Evolve the per-card FSRS state online, so it stays current between retrains.
      const effDifficulty =
        typeof difficulty === "number" ? difficulty : c.avgDifficulty;
      const grade = fsrsGradeFromReview({
        correct,
        difficulty: effDifficulty,
        responseTimeMs: respMs || undefined,
      } as Review);
      const prevState =
        c.stability != null && c.fsrsDifficulty != null
          ? { stability: c.stability, difficulty: c.fsrsDifficulty }
          : null;
      const nextFsrs = advanceFsrsState(prevState, grade, daysSince);
      c.stability = nextFsrs.stability;
      c.fsrsDifficulty = nextFsrs.difficulty;
      c.fsrsReps = (c.fsrsReps || 0) + 1;
      if (grade === 1) c.fsrsLapses = (c.fsrsLapses || 0) + 1;

      // Refresh the cached study-habit signals from this card's full trail (the row
      // just pushed is included), so live scoring stays in step with the trainer.
      const trail = d.reviews
        .filter((r) => r.conceptId === c.id)
        .sort(
          (a, b) =>
            new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()
        );
      const habits = behaviorAggregates(trail);
      c.nightStudyRate = habits.nightStudyRate;
      c.massedPracticeRate = habits.massedPracticeRate;
      c.studyRoutine = habits.studyRoutine;

      c.lastReviewedAt = now;

      const u = d.users.find((x) => x.id === user.id);
      if (u) {
        brains = recordActivity(u, activityDelta);
        // Track this session's study earnings so the end-of-session efficiency
        // bonus multiplies a server-known base (not a client-reported number).
        if (!isPoker && correct) {
          const buckets = u.sessionStudy ?? (u.sessionStudy = {});
          buckets[sid] = (buckets[sid] || 0) + BRAINS_PER_CORRECT;
          pruneSessionStudy(u);
        }
      }
    });

    return jsonOk({ ok: true, correct, trapFailed, brains });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Review failed", 500);
  }
}

/** End-of-session: retrain HLR on full history */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json().catch(() => ({}));
    const retrain = body?.retrain !== false;
    const model = retrain ? await retrainUserModel(user.id) : null;
    return jsonOk({
      ok: true,
      model: model
        ? {
            trainedAt: model.trainedAt,
            trainedOnReviewCount: model.trainedOnReviewCount,
            heldOutLogLoss: model.heldOutLogLoss,
            baselineLogLoss: model.baselineLogLoss,
          }
        : null,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Retrain failed", 500);
  }
}
