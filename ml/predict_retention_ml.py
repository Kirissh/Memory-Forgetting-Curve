"""Load trained retention ML artifacts (inference helper — not used by the app yet).

Example:
  from ml.predict_retention_ml import predict_proba, predict_half_life
  p = predict_proba(features, delta_t_days=1.5, backend="auto")
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Literal, Sequence

import joblib
import numpy as np
import torch
import torch.nn as nn

ART = Path(__file__).resolve().parent / "artifacts"


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

    def half_life(self, x: torch.Tensor) -> torch.Tensor:
        z = self.backbone(x)
        return torch.exp(self.log_h_head(z).clamp(-1.5, 4.0))

    def forward(self, x: torch.Tensor, delta_t: torch.Tensor):
        h = self.half_life(x)
        p = torch.pow(2.0, -delta_t / h.clamp_min(1e-3)).clamp(1e-5, 1 - 1e-5)
        return p, h


def _load_net():
    ckpt = torch.load(ART / "retention_net.pt", map_location="cpu", weights_only=False)
    model = RetentionNet(ckpt["n_features"])
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, ckpt.get("feature_names")


def _load_gbm():
    blob = joblib.load(ART / "retention_gbm.joblib")
    return blob["model"], blob["feature_names"]


def predict_half_life(features: Sequence[float]) -> float:
    model, _ = _load_net()
    x = torch.tensor([list(features)], dtype=torch.float32)
    with torch.no_grad():
        h = model.half_life(x)
    return float(h.item())


def predict_proba(
    features: Sequence[float],
    delta_t_days: float,
    backend: Literal["auto", "net", "gbm"] = "auto",
) -> float:
    """Return P(correct / recall)."""
    metrics_path = ART / "retention_ml_metrics.json"
    champ = "gbm"
    if metrics_path.exists():
        import json

        champ = json.loads(metrics_path.read_text()).get("champion", "gbm")

    use = backend if backend != "auto" else champ

    if use == "gbm":
        clf, _ = _load_gbm()
        X = np.asarray([list(features)], dtype=np.float64)
        return float(clf.predict_proba(X)[0, 1])

    model, _ = _load_net()
    x = torch.tensor([list(features)], dtype=torch.float32)
    dt = torch.tensor([[max(delta_t_days, 1e-4)]], dtype=torch.float32)
    with torch.no_grad():
        p, _ = model(x, dt)
    return float(p.item())


if __name__ == "__main__":
    # smoke test if artifacts exist
    if (ART / "retention_net.pt").exists():
        demo = [0, 0, math.log1p(1), 1.0, 1.0, math.log1p(8), math.log1p(4), 0, 0.5, 0]
        print("half-life days:", round(predict_half_life(demo), 3))
        print("P@1d (auto):", round(predict_proba(demo, 1.0), 3))
    else:
        print("No artifacts yet — run python ml/train_retention_ml.py")
