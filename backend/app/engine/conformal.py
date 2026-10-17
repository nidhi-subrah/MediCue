"""Split conformal prediction over needs.

Nonconformity score s = 1 − b(true need). On calibration dialogues we take the
⌈(n+1)(1−α)⌉/n empirical quantile q̂; at run time the set is {needs with 1 − b(n) ≤ q̂},
which contains the true need with probability ≥ 1 − α (on exchangeable data).
"""
import math


class ConformalPredictor:
    def __init__(self, alpha: float = 0.1):
        self.alpha = alpha
        self.qhat: float = 0.9  # conservative default until calibrated
        self.n_calibration = 0

    def calibrate(self, scores: list[float]) -> float:
        n = len(scores)
        if n == 0:
            return self.qhat
        k = min(math.ceil((n + 1) * (1 - self.alpha)), n)
        self.qhat = sorted(scores)[k - 1]
        self.n_calibration = n
        return self.qhat

    def predict_set(self, need_ids: list[str], belief: list[float]) -> list[str]:
        order = sorted(range(len(belief)), key=lambda i: -belief[i])
        chosen = [need_ids[i] for i in order if 1 - belief[i] <= self.qhat]
        return chosen or [need_ids[order[0]]]
