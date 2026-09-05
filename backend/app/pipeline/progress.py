"""Dynamic progress mapping: stage spans proportional to measured durations.

Every analysis records its per-stage wall times (storage.save_stage_record)
and the next run distributes the progress bar proportionally to the median
measured durations. DEFAULT_WEIGHTS approximate the original hand-tuned
distribution; CS2_PROGRESS_WEIGHTS (JSON: stage -> relative seconds) pins the
weights manually and takes precedence over auto-calibration.
"""
import json
import os
import time

from .. import storage

LO, HI = 2, 98  # progress bar bounds covered by pipeline stages

# Fixed stage order; keys are unique block boundaries. DISPLAY_PHASE maps them
# to the phase strings the frontend renders in the demo card.
STAGE_ORDER = [
    "probe", "events", "ticks", "grenades", "rounds", "frames", "players",
    "replay_events", "winprob", "heatmaps", "analytics", "chat", "writing",
]
DISPLAY_PHASE = {"replay_events": "events"}

# Fallback used until the first real measurement lands.
DEFAULT_WEIGHTS = {
    "probe": 8, "events": 6, "ticks": 22, "grenades": 6,
    "rounds": 2, "frames": 14, "players": 4, "replay_events": 2,
    "winprob": 2, "heatmaps": 3, "analytics": 8, "chat": 1, "writing": 3,
}


def effective_weights() -> dict[str, float]:
    """defaults <- auto-calibrated medians <- CS2_PROGRESS_WEIGHTS pin."""
    weights = dict(DEFAULT_WEIGHTS)
    measured = storage.stage_weights()
    if measured:
        for k, v in measured.items():
            if k in weights and v > 0:
                weights[k] = float(v)
    env = os.environ.get("CS2_PROGRESS_WEIGHTS", "").strip()
    if env:
        try:
            pinned = json.loads(env)
            if isinstance(pinned, dict):
                for k, v in pinned.items():
                    if k in weights and isinstance(v, (int, float)) and v > 0:
                        weights[k] = float(v)
        except ValueError:
            pass
    return weights


def spans(weights: dict[str, float]) -> dict[str, tuple[int, int]]:
    """Percent span [start, end] per stage across LO..HI (monotonic)."""
    total = float(sum(max(0.0, float(weights.get(s, 0))) for s in STAGE_ORDER)) or 1.0
    out = {}
    cum = 0.0
    for s in STAGE_ORDER:
        start = LO + (HI - LO) * cum / total
        cum += max(0.0, float(weights.get(s, 0)))
        out[s] = (int(round(start)), int(round(LO + (HI - LO) * cum / total)))
    prev = LO
    for s in STAGE_ORDER:
        a, b = out[s]
        a, b = max(a, prev), max(b, max(a, prev))
        out[s] = (a, b)
        prev = b
    return out


class StageTracker:
    """Times pipeline stages and emits (phase, pct, detail) status updates."""

    def __init__(self, weights: dict[str, float], on_update):
        self._map = spans(weights)
        self._emit = on_update or (lambda phase, pct, detail="": None)
        self._cur = None
        self._t0 = None
        self.seconds: dict[str, float] = {}

    @staticmethod
    def phase_of(stage: str) -> str:
        return DISPLAY_PHASE.get(stage, stage)

    def enter(self, stage: str, detail: str = ""):
        self._close()
        self._cur = stage
        self._t0 = time.perf_counter()
        self._emit(self.phase_of(stage), self._map.get(stage, (LO, HI))[0], detail)

    def update(self, stage: str, frac: float, detail: str = ""):
        a, b = self._map.get(stage, (LO, HI))
        frac = min(1.0, max(0.0, float(frac)))
        pct = min(b - 1, a + int((b - a) * frac))
        self._emit(self.phase_of(stage), max(a, pct), detail)

    def close_all(self):
        self._close()

    def _close(self):
        if self._cur is None:
            return
        self.seconds[self._cur] = round(time.perf_counter() - self._t0, 2)
        self._cur = None
        self._t0 = None
