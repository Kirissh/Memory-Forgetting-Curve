"""Half-Life Regression training (mirrors src/lib/retention.ts).

  pip install numpy scikit-learn
  python ml/train_hlr.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from sklearn.linear_model import Ridge

FEATURE_NAMES = [
    "bias",
    "correct_streak",
    "incorrect_count",
    "log_total_reviews",
    "avg_days_between_reviews",
    "days_since_last_review",
    "concept_embedding_similarity",
    "log_read_time",
    "log_response_time",
    "trap_fail_rate",
    "difficulty",
]


def log_seconds(ms: float | None, fallback: float) -> float:
    sec = (ms / 1000.0) if ms and ms > 0 else fallback
    return math.log1p(min(max(sec, 0.05), 120.0))


def norm_difficulty(d: float | None) -> float:
    if d is None:
        return 0.5
    return (min(5.0, max(1.0, float(d))) - 1.0) / 4.0


def observed_half_life(
    delta_t_days: float,
    was_correct: bool,
    trap_failed: bool = False,
    difficulty: float | None = None,
) -> float:
    p = 0.95 if was_correct else 0.05
    if trap_failed:
        p = 0.02
    if (not was_correct) and difficulty is not None and difficulty >= 4:
        p = min(p, 0.03)
    return max(delta_t_days / -np.log2(p), 0.5)


def train(X: np.ndarray, y: np.ndarray, alpha: float = 1.0) -> np.ndarray:
    model = Ridge(alpha=alpha, fit_intercept=False)
    model.fit(X, y)
    return model.coef_


def main() -> None:
    db_path = Path(__file__).resolve().parents[1] / ".data" / "db.json"
    if not db_path.exists():
        print("No .data/db.json — use the app first, or npm run seed")
        return

    db = json.loads(db_path.read_text())
    reviews = db.get("reviews", [])
    concepts = {c["id"]: c for c in db.get("concepts", [])}

    if len(reviews) < 10:
        print(f"Need ≥10 reviews (have {len(reviews)})")
        return

    X, y = [], []
    for r in reviews:
        c = concepts.get(r["conceptId"])
        if not c:
            continue
        trap_failed = bool(r.get("trapFailed"))
        difficulty = r.get("difficulty", c.get("avgDifficulty"))
        X.append(
            [
                1.0,
                c.get("correctStreak", 0),
                c.get("incorrectCount", 0),
                np.log1p(c.get("totalReviews", 1)),
                c.get("avgDaysBetweenReviews", 0),
                r.get("daysSinceLastReview", 0),
                0.0,
                log_seconds(r.get("readTimeMs") or c.get("avgReadTimeMs"), 8.0),
                log_seconds(
                    r.get("responseTimeMs") or c.get("avgResponseTimeMs"), 4.0
                ),
                1.0 if trap_failed else float(c.get("trapFailRate") or 0.0),
                norm_difficulty(difficulty),
            ]
        )
        y.append(
            np.log(
                observed_half_life(
                    max(r.get("daysSinceLastReview", 0.1), 0.1),
                    r["correct"],
                    trap_failed,
                    difficulty,
                )
            )
        )

    coef = train(np.array(X), np.array(y))
    print("feature weights:")
    for name, w in zip(FEATURE_NAMES, coef):
        print(f"  {name:28s} {w:+.4f}")


if __name__ == "__main__":
    main()
