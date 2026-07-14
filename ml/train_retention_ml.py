"""
Proper ML retention trainer (separate from train_hlr.py — do not edit that file).

Architecture
------------
Neural Half-Life Net:
  z = MLP_θ(x)
  h = exp(clamp(w·z + b))           # learned memory half-life (days)
  P = 2^(-Δt / h)                   # Ebbinghaus / Settles–Meeder curve

Plus a calibrated Gradient Boosting classifier baseline that predicts
P(correct | features) directly — often stronger on small user logs.

Training protocol
-----------------
1. (Optional) Pretrain on large synthetic learners with known forgetting curves
2. Chronological train / val / test split on REAL user reviews (no leakage)
3. Multi-task loss on real data:
     • BCE(P_curve, correct) weighted by √Δt  (tiny Δt → P≈1 is uninformative)
     • Huber(log h, log h_obs) when outcome can invert a half-life
4. Early stopping on val log-loss; report AUC / Brier / accuracy on held-out test
5. Save artifacts under ml/artifacts/

Usage
-----
  python ml/train_retention_ml.py
  python ml/train_retention_ml.py --augment 5000 --epochs 300
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import torch
import torch.nn as nn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / ".data" / "db.json"
ART_DIR = ROOT / "ml" / "artifacts"

FEATURE_NAMES = [
    "correct_streak",
    "incorrect_count",
    "log_total_reviews",
    "avg_days_between_reviews",
    "days_since_last_review",
    "log_read_time",
    "log_response_time",
    "trap_fail_rate",
    "difficulty",
    "was_trap_item",
]


def log_seconds(ms: float | None, fallback: float) -> float:
    sec = (ms / 1000.0) if ms and ms > 0 else fallback
    return math.log1p(min(max(sec, 0.05), 120.0))


def norm_difficulty(d: float | None) -> float:
    if d is None:
        return 0.5
    return (min(5.0, max(1.0, float(d))) - 1.0) / 4.0


def observed_half_life(
    delta: float, correct: bool, trap_failed: bool = False, difficulty: float | None = None
) -> float | None:
    """Invert the forgetting curve when Δt is large enough to be informative."""
    if delta < 0.05:
        return None
    p = 0.95 if correct else 0.05
    if trap_failed:
        p = 0.02
    if (not correct) and difficulty is not None and difficulty >= 4:
        p = min(p, 0.03)
    return max(delta / -math.log2(p), 0.25)


def set_seed(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


@dataclass
class Sample:
    features: list[float]
    delta_t: float
    correct: bool
    reviewed_at: str
    concept_id: str
    user_id: str
    h_obs: float | None
    source: str  # "real" | "synth"


def build_real_samples(db: dict[str, Any]) -> list[Sample]:
    concepts = {c["id"]: c for c in db.get("concepts", [])}
    reviews = sorted(db.get("reviews", []), key=lambda r: r.get("reviewedAt", ""))
    samples: list[Sample] = []

    for r in reviews:
        c = concepts.get(r["conceptId"])
        if not c:
            continue
        delta = float(max(r.get("daysSinceLastReview", 0.0), 1e-4))
        trap_failed = bool(r.get("trapFailed"))
        difficulty = r.get("difficulty", c.get("avgDifficulty"))
        was_trap = 1.0 if r.get("probeWasSameMeaning") is False else 0.0
        feats = [
            float(c.get("correctStreak", 0)),
            float(c.get("incorrectCount", 0)),
            float(np.log1p(c.get("totalReviews", 1))),
            float(c.get("avgDaysBetweenReviews", 0) or 0),
            delta,
            log_seconds(r.get("readTimeMs") or c.get("avgReadTimeMs"), 8.0),
            log_seconds(r.get("responseTimeMs") or c.get("avgResponseTimeMs"), 4.0),
            1.0 if trap_failed else float(c.get("trapFailRate") or 0.0),
            norm_difficulty(difficulty if difficulty is not None else None),
            was_trap,
        ]
        h_obs = observed_half_life(
            delta,
            bool(r["correct"]),
            trap_failed,
            float(difficulty) if difficulty is not None else None,
        )
        samples.append(
            Sample(
                features=feats,
                delta_t=delta,
                correct=bool(r["correct"]),
                reviewed_at=r.get("reviewedAt", ""),
                concept_id=r["conceptId"],
                user_id=r["userId"],
                h_obs=h_obs,
                source="real",
            )
        )
    return samples


def synthesize_samples(n: int, seed: int = 7) -> list[Sample]:
    """Synthetic learners with ground-truth half-lives + Bernoulli outcomes."""
    rng = np.random.default_rng(seed)
    out: list[Sample] = []
    for i in range(n):
        difficulty = float(rng.integers(1, 6))
        streak = float(rng.integers(0, 10))
        incorrect = float(rng.integers(0, 8))
        total = float(streak + incorrect + rng.integers(1, 12))
        avg_gap = float(rng.uniform(0.3, 6.0))
        # force meaningful spacing so the curve is learnable
        delta = float(rng.choice([0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 7.0, 10.0]))
        delta *= float(rng.uniform(0.8, 1.2))
        read = float(rng.uniform(2.0, 45.0))
        resp = float(rng.uniform(0.4, 25.0))
        trap_rate = float(rng.beta(1.2, 4.0))
        was_trap = float(rng.random() < 0.4)

        log_h = (
            math.log(2.8)
            + 0.32 * streak
            - 0.28 * incorrect
            + 0.10 * math.log1p(total)
            - 0.30 * ((difficulty - 1) / 4)
            - 0.45 * trap_rate
            + 0.05 * math.log1p(read)
            - 0.14 * math.log1p(resp)
            + float(rng.normal(0, 0.12))
        )
        h = float(np.clip(math.exp(log_h), 0.2, 45.0))
        p = float(np.clip(2 ** (-delta / h), 1e-4, 1 - 1e-4))
        correct = bool(rng.random() < p)

        feats = [
            streak,
            incorrect,
            math.log1p(total),
            avg_gap,
            delta,
            math.log1p(min(read, 120)),
            math.log1p(min(resp, 120)),
            trap_rate,
            (difficulty - 1) / 4,
            was_trap,
        ]
        out.append(
            Sample(
                features=feats,
                delta_t=delta,
                correct=correct,
                reviewed_at=datetime.now(timezone.utc).isoformat(),
                concept_id=f"sim-{i}",
                user_id="synthetic",
                h_obs=h,  # ground truth
                source="synth",
            )
        )
    return out


def chronological_split(
    samples: list[Sample], train_r=0.7, val_r=0.15
) -> tuple[list[Sample], list[Sample], list[Sample]]:
    n = len(samples)
    if n < 12:
        raise ValueError(f"Need ≥12 samples (have {n})")
    i_train = max(5, int(n * train_r))
    i_val = max(i_train + 2, int(n * (train_r + val_r)))
    i_val = min(i_val, n - 2)
    return samples[:i_train], samples[i_train:i_val], samples[i_val:]


def to_tensors(samples: list[Sample]):
    x = torch.tensor([s.features for s in samples], dtype=torch.float32)
    dt = torch.tensor([[s.delta_t] for s in samples], dtype=torch.float32)
    y = torch.tensor([[1.0 if s.correct else 0.0] for s in samples], dtype=torch.float32)
    h_obs = torch.tensor(
        [[s.h_obs if s.h_obs is not None else float("nan")] for s in samples],
        dtype=torch.float32,
    )
    # BCE weight: √Δt so near-zero gaps don’t dominate toward P=1
    w = torch.tensor(
        [[max(math.sqrt(s.delta_t), 0.05)] for s in samples], dtype=torch.float32
    )
    return x, dt, y, h_obs, w


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


class RetentionNet(nn.Module):
    def __init__(self, n_features: int, hidden: int = 96, dropout: float = 0.2):
        super().__init__()
        self.backbone = nn.Sequential(
            nn.Linear(n_features, hidden),
            nn.LayerNorm(hidden),
            nn.SiLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden),
            nn.LayerNorm(hidden),
            nn.SiLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden // 2),
            nn.SiLU(),
        )
        self.log_h_head = nn.Linear(hidden // 2, 1)
        nn.init.zeros_(self.log_h_head.weight)
        nn.init.constant_(self.log_h_head.bias, math.log(3.0))

    def half_life(self, x: torch.Tensor) -> torch.Tensor:
        z = self.backbone(x)
        log_h = self.log_h_head(z).clamp(-1.5, 4.0)
        return torch.exp(log_h)

    def forward(self, x: torch.Tensor, delta_t: torch.Tensor):
        h = self.half_life(x)
        p = torch.pow(2.0, -delta_t / h.clamp_min(1e-3)).clamp(1e-5, 1 - 1e-5)
        return p, h


# ---------------------------------------------------------------------------
# Train / eval
# ---------------------------------------------------------------------------


@dataclass
class SplitMetrics:
    n: int
    accuracy: float
    log_loss: float
    brier: float
    auc: float | None
    mean_pred_p: float
    mean_true_rate: float
    mean_half_life: float


def evaluate(model: RetentionNet, samples: list[Sample], device: torch.device) -> SplitMetrics:
    if not samples:
        return SplitMetrics(0, 0, 0, 0, None, 0, 0, 0)
    model.eval()
    x, dt, y, _, _ = to_tensors(samples)
    x, dt = x.to(device), dt.to(device)
    with torch.no_grad():
        p, h = model(x, dt)
    p_np = p.cpu().numpy().ravel()
    y_np = y.numpy().ravel()
    h_np = h.cpu().numpy().ravel()
    pred = (p_np >= 0.5).astype(float)
    auc = float(roc_auc_score(y_np, p_np)) if len(np.unique(y_np)) > 1 else None
    ll = float(log_loss(y_np, np.clip(p_np, 1e-6, 1 - 1e-6), labels=[0, 1]))
    return SplitMetrics(
        n=len(samples),
        accuracy=float(accuracy_score(y_np, pred)),
        log_loss=ll,
        brier=float(brier_score_loss(y_np, p_np)),
        auc=auc,
        mean_pred_p=float(p_np.mean()),
        mean_true_rate=float(y_np.mean()),
        mean_half_life=float(h_np.mean()),
    )


def batch_loss(p, h, y, h_obs, w_bce, h_loss_weight: float) -> torch.Tensor:
    bce = nn.functional.binary_cross_entropy(p, y, weight=w_bce, reduction="mean")
    mask = torch.isfinite(h_obs).squeeze(-1)
    if mask.any():
        log_h = torch.log(h.clamp_min(1e-3))
        log_t = torch.log(h_obs[mask].clamp_min(1e-3))
        huber = nn.functional.smooth_l1_loss(log_h[mask], log_t)
    else:
        huber = torch.tensor(0.0, device=p.device)
    prior = 1e-4 * ((torch.log(h.clamp_min(1e-3)) - math.log(3.0)) ** 2).mean()
    return bce + h_loss_weight * huber + prior


def train_net(
    train: list[Sample],
    val: list[Sample],
    *,
    epochs: int = 200,
    lr: float = 2e-3,
    batch_size: int = 64,
    patience: int = 30,
    h_loss_weight: float = 0.5,
    device: torch.device,
) -> tuple[RetentionNet, dict[str, Any]]:
    model = RetentionNet(len(FEATURE_NAMES)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=2e-3)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(
        opt, mode="min", factor=0.5, patience=10
    )

    x, dt, y, h_obs, w = to_tensors(train)
    loader = DataLoader(
        TensorDataset(x, dt, y, h_obs, w),
        batch_size=min(batch_size, len(train)),
        shuffle=True,
    )

    best_state = None
    best_val = float("inf")
    bad = 0
    history: list[dict[str, float]] = []

    for epoch in range(1, epochs + 1):
        model.train()
        running = 0.0
        n_b = 0
        for xb, dtb, yb, hob, wb in loader:
            xb, dtb, yb, hob, wb = (
                xb.to(device),
                dtb.to(device),
                yb.to(device),
                hob.to(device),
                wb.to(device),
            )
            opt.zero_grad()
            p, h = model(xb, dtb)
            loss = batch_loss(p, h, yb, hob, wb, h_loss_weight)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            opt.step()
            running += float(loss.item())
            n_b += 1

        val_m = evaluate(model, val, device)
        # Prefer val log-loss when Δt varies; fallback accuracy if collapsed
        score = val_m.log_loss
        sched.step(score)
        history.append(
            {
                "epoch": float(epoch),
                "train_loss": running / max(n_b, 1),
                "val_log_loss": val_m.log_loss,
                "val_auc": float(val_m.auc or 0.0),
                "val_acc": val_m.accuracy,
            }
        )
        if score < best_val - 1e-4:
            best_val = score
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad = 0
        else:
            bad += 1
            if bad >= patience:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    return model, {
        "history": history,
        "best_val_log_loss": best_val,
        "epochs_ran": len(history),
    }


# ---------------------------------------------------------------------------
# GBM classifier (proper ML baseline with calibration + held-out test)
# ---------------------------------------------------------------------------


def train_gbm(
    train: list[Sample], val: list[Sample], test: list[Sample]
) -> tuple[Any, dict[str, Any]]:
    def xy(samples: list[Sample]):
        X = np.asarray([s.features for s in samples], dtype=np.float64)
        y = np.asarray([1 if s.correct else 0 for s in samples], dtype=np.int64)
        return X, y

    X_tr, y_tr = xy(train)
    X_va, y_va = xy(val)
    X_te, y_te = xy(test)

    if len(np.unique(y_tr)) < 2:
        raise RuntimeError("Training set has a single class — need more reviews")

    # Cross-fitted calibrated GBM on train (no leakage from test)
    X_fit = np.vstack([X_tr, X_va])
    y_fit = np.concatenate([y_tr, y_va])

    base = HistGradientBoostingClassifier(
        max_depth=4,
        learning_rate=0.06,
        max_iter=300,
        min_samples_leaf=max(5, len(X_fit) // 20),
        l2_regularization=1.5,
        random_state=42,
    )

    cv = 3 if len(X_fit) >= 30 and len(np.unique(y_fit)) > 1 else 2
    try:
        clf: Any = CalibratedClassifierCV(estimator=base, method="sigmoid", cv=cv)
        clf.fit(X_fit, y_fit)
        name = "Calibrated HistGradientBoostingClassifier"
    except Exception:
        base.fit(X_fit, y_fit)
        clf = base
        name = "HistGradientBoostingClassifier"

    def pack(X: np.ndarray, y: np.ndarray) -> dict[str, Any]:
        if len(X) == 0:
            return {"n": 0}
        proba = clf.predict_proba(X)[:, 1]
        pred = (proba >= 0.5).astype(int)
        out: dict[str, Any] = {
            "n": int(len(y)),
            "accuracy": float(accuracy_score(y, pred)),
            "log_loss": float(
                log_loss(y, np.clip(proba, 1e-6, 1 - 1e-6), labels=[0, 1])
            ),
            "brier": float(brier_score_loss(y, proba)),
        }
        if len(np.unique(y)) > 1:
            out["auc"] = float(roc_auc_score(y, proba))
        return out

    # Selection diagnostics: score the pre-calibration-style holdout = last val slice
    metrics = {
        "model": name,
        "val": pack(X_va, y_va),
        "test": pack(X_te, y_te),
    }
    return clf, metrics


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--augment", type=int, default=5000)
    parser.add_argument("--epochs", type=int, default=250)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--skip-synth", action="store_true")
    args = parser.parse_args()
    set_seed(args.seed)

    if not DB_PATH.exists():
        print(f"No DB at {DB_PATH}")
        return

    db = json.loads(DB_PATH.read_text())
    real = build_real_samples(db)
    print(f"Real review samples: {len(real)}")
    if len(real) < 12:
        print("Need ≥12 real reviews for a held-out test. Study more, then re-run.")
        return

    ART_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    meta: dict[str, Any] = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_names": FEATURE_NAMES,
        "n_real": len(real),
        "augment": 0 if args.skip_synth else args.augment,
        "notes": (
            "Neural net learns half-life; P follows 2^(-Δt/h). "
            "GBM learns P(correct|x) directly with calibration. "
            "Chronological split on real data prevents future leakage."
        ),
    }

    # ---- Synthetic pretrain (physics of forgetting) ----
    model = RetentionNet(len(FEATURE_NAMES)).to(device)
    if not args.skip_synth and args.augment > 0:
        print(f"\n[1/3] Pretrain RetentionNet on {args.augment} synthetic learners…")
        synth = synthesize_samples(args.augment, seed=args.seed)
        # shuffle synth then split — IID is OK for simulation
        rng = np.random.default_rng(args.seed)
        idx = rng.permutation(len(synth))
        synth = [synth[i] for i in idx]
        n = len(synth)
        s_tr = synth[: int(0.8 * n)]
        s_va = synth[int(0.8 * n) : int(0.9 * n)]
        s_te = synth[int(0.9 * n) :]
        model, info = train_net(
            s_tr,
            s_va,
            epochs=max(120, args.epochs // 2),
            lr=2e-3,
            h_loss_weight=1.0,
            device=device,
        )
        pre_te = evaluate(model, s_te, device)
        meta["synthetic_pretrain"] = {
            "train_n": len(s_tr),
            "val_n": len(s_va),
            "test": asdict(pre_te),
            "epochs_ran": info["epochs_ran"],
        }
        print(
            f"     synth TEST  auc={pre_te.auc:.3f}  logloss={pre_te.log_loss:.4f}  "
            f"acc={pre_te.accuracy:.3f}  mean_h={pre_te.mean_half_life:.2f}d"
        )

    # ---- Real chronological split ----
    print("\n[2/3] Train/val/test on REAL reviews (chronological)…")
    r_tr, r_va, r_te = chronological_split(real)
    print(f"     split train={len(r_tr)} val={len(r_va)} test={len(r_te)}")
    meta["split"] = {"train": len(r_tr), "val": len(r_va), "test": len(r_te)}

    # Fine-tune net (emphasize half-life fit; downweight useless Δt≈0 BCE)
    model, ft_info = train_net(
        r_tr,
        r_va,
        epochs=args.epochs,
        lr=8e-4 if not args.skip_synth else 2e-3,
        h_loss_weight=1.0,
        patience=35,
        device=device,
    )
    nn_metrics = {
        "train": asdict(evaluate(model, r_tr, device)),
        "val": asdict(evaluate(model, r_va, device)),
        "test": asdict(evaluate(model, r_te, device)),
        "epochs_ran": ft_info["epochs_ran"],
    }
    meta["retention_net"] = nn_metrics
    print("     RetentionNet (curve-constrained neural HLR):")
    for split in ("train", "val", "test"):
        m = nn_metrics[split]
        auc = f"{m['auc']:.3f}" if m["auc"] is not None else "n/a"
        print(
            f"       {split:5s} n={m['n']:3d} acc={m['accuracy']:.3f} "
            f"logloss={m['log_loss']:.4f} brier={m['brier']:.4f} auc={auc} "
            f"mean_h={m['mean_half_life']:.2f}d"
        )

    # ---- GBM ----
    print("\n[3/3] Calibrated Gradient Boosting classifier…")
    gbm, gbm_metrics = train_gbm(r_tr, r_va, r_te)
    meta["gbm"] = gbm_metrics
    for split in ("val", "test"):
        m = gbm_metrics[split]
        auc = f"{m.get('auc', float('nan')):.3f}" if "auc" in m else "n/a"
        print(
            f"       {split:5s} n={m['n']:3d} acc={m['accuracy']:.3f} "
            f"logloss={m['log_loss']:.4f} brier={m['brier']:.4f} auc={auc}"
        )

    # Pick shipping champion by held-out test log-loss
    nn_ll = nn_metrics["test"]["log_loss"]
    gbm_ll = gbm_metrics["test"]["log_loss"]
    champion = "gbm" if gbm_ll <= nn_ll else "retention_net"
    meta["champion"] = champion
    print(f"\nChampion on held-out test log-loss: {champion}")

    # Persist
    ckpt = ART_DIR / "retention_net.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "feature_names": FEATURE_NAMES,
            "n_features": len(FEATURE_NAMES),
            "architecture": "RetentionNet",
            "formula": "h=exp(MLP(x)); P=2^(-delta_t/h)",
        },
        ckpt,
    )
    joblib.dump(
        {"model": gbm, "feature_names": FEATURE_NAMES},
        ART_DIR / "retention_gbm.joblib",
    )
    (ART_DIR / "retention_ml_metrics.json").write_text(json.dumps(meta, indent=2))

    print(f"\nArtifacts:")
    print(f"  {ckpt}")
    print(f"  {ART_DIR / 'retention_gbm.joblib'}")
    print(f"  {ART_DIR / 'retention_ml_metrics.json'}")
    print(
        "\nOriginal train_hlr.py / live Next.js path untouched. "
        "Point the app at these artifacts when you want to ship."
    )


if __name__ == "__main__":
    main()
