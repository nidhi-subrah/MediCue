import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class EngineConfig:
    """Tunable weights for the decision engine. See docs in app/engine/decision.py."""
    info_weight: float = 0.5          # μ: value of one bit, as a fraction of the belief-weighted miss cost
    lambda_fatigue: float = 0.5       # weight of patient effort per question
    lambda_delay: float = 1.0         # weight of delay x risk
    lambda_their_time: float = 5.0    # cost of interrupting a consulted person
    false_alarm_cost: float = 40.0    # cost of pulling a nurse to the bedside for a low-risk need
    escalate_threshold: float = 0.25  # P(any high-risk need) that forces escalation (safety floor)
    max_questions: int = 4            # hard cap on clarifying questions per session
    max_inconsistent_answers: float = 2.0  # stop asking the patient after this many surprising answers
    delay_ask: float = 1.0            # ~10 s per question
    delay_lookup: float = 0.02
    delay_consult: float = 8.0        # ~2 min waiting for a reply
    alpha: float = 0.10               # conformal miscoverage (90% sets)
    tap_background: float = 0.05      # affinity given to taps a need does not list


@dataclass(frozen=True)
class Settings:
    shared_dir: Path = Path(os.getenv("SHARED_DIR", REPO_ROOT / "shared"))
    database_url: str | None = os.getenv("DATABASE_URL") or None
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY") or None
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    frontend_dist: Path = Path(os.getenv("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"))
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv("CORS_ORIGINS", "*").split(","))
    seed_demo_data: bool = os.getenv("SEED_DEMO_DATA", "1") == "1"
    consult_timeout_s: float = float(os.getenv("CONSULT_TIMEOUT_S", "120"))
    welfare_timeout_s: float = float(os.getenv("WELFARE_TIMEOUT_S", "45"))
    unit_tz: ZoneInfo = ZoneInfo(os.getenv("UNIT_TZ", "America/Toronto"))
    engine: EngineConfig = field(default_factory=EngineConfig)


settings = Settings()
