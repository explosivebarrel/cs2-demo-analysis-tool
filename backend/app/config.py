"""Central configuration and constants for the CS2 demo analyzer."""
import os

# ---------------------------------------------------------------- paths
BASE_DIR = os.environ.get("CS2_DATA_DIR", "/data")
INBOX_DIR = os.environ.get("CS2_INBOX_DIR", os.path.join(BASE_DIR, "inbox"))
STORE_DIR = os.path.join(BASE_DIR, "store")
UPLOADS_DIR = os.path.join(STORE_DIR, "uploads")
ANALYSES_DIR = os.path.join(STORE_DIR, "analyses")
STATUS_DIR = os.path.join(STORE_DIR, "status")
RADARS_DIR = os.path.join(STORE_DIR, "radars")

for _d in (BASE_DIR, STORE_DIR, UPLOADS_DIR, ANALYSES_DIR, STATUS_DIR, RADARS_DIR):
    os.makedirs(_d, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.environ.get("CS2_MAX_UPLOAD_MB", "1200")) * 1024 * 1024

# ------------------------------------------------------- radar sources
RADAR_REPO = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main"
RADAR_INFO_URL = RADAR_REPO + "/data/radar_info/{map}.txt"
RADAR_IMG_URL = RADAR_REPO + "/images/radars/{map}_radar_psd.png"
RADAR_FETCH_TIMEOUT = 20  # seconds

# ------------------------------------------------------- analysis constants
# Frame step for the replay timeline: keep ~8 samples per second.
FRAME_SECONDS = 0.125
POSITION_DENSITY_STEP = 4      # take every Nth replay frame for position heatmap
HOLD_MIN_SECONDS = 5.0         # player counted as "holding" after this long
HOLD_RADIUS_UNITS = 90.0       # max displacement while holding an angle
TRADE_WINDOW_SECONDS = 5.0     # avenger window for a traded death
FLASH_EFFECTIVE_SECONDS = 2.2  # enemy flash counts as effective above this
OPENING_PHASE_SECONDS = 15.0   # "early" round phase length
MID_PHASE_SECONDS = 45.0       # "mid" round phase end (from freeze end)

# Buy classification by average spend per player (approximation)
BUY_FULL_MIN = 3900
BUY_FORCE_MIN = 1900

# Rating 2.1 (approx) sub-rating weights
RATING_WEIGHTS = {
    "kill": 0.30,
    "survival": 0.25,
    "damage": 0.20,
    "kast": 0.15,
    "impact": 0.10,
}

KNOWN_MAPS_HINT = [
    "de_ancient", "de_anubis", "de_dust2", "de_inferno", "de_mirage",
    "de_nuke", "de_overpass", "de_train", "de_vertigo", "de_cache",
    "de_office", "de_mills", "de_arena", "de_brewery", "de_golden",
]

# --------------------------------------------------------- player benchmarks
# Tiers based on Faceit/Premier competitive population data.
# Keys match PlayerData / PlayerMetrics field names used on the frontend.
BENCHMARKS: dict[str, dict[str, float]] = {
    "adr":             {"weak": 55,   "avg": 70,   "good": 85,   "elite": 100},
    "kd":              {"weak": 0.7,  "avg": 0.9,  "good": 1.1,  "elite": 1.4},
    "kast":            {"weak": 60,   "avg": 70,   "good": 78,   "elite": 85 },
    "hsPct":           {"weak": 30,   "avg": 45,   "good": 55,   "elite": 65 },
    "rating":          {"weak": 0.8,  "avg": 1.0,  "good": 1.15, "elite": 1.3},
    "openingWinPct":   {"weak": 40,   "avg": 50,   "good": 60,   "elite": 70 },
    "tradeKillPct":    {"weak": 15,   "avg": 25,   "good": 35,   "elite": 45 },
    "tradedDeathPct":  {"weak": 20,   "avg": 35,   "good": 50,   "elite": 65 },
    "flashEfficiency": {"weak": 20,   "avg": 40,   "good": 60,   "elite": 75 },
    "clutchWinPct":    {"weak": 15,   "avg": 25,   "good": 35,   "elite": 50 },
    "idealStrafePct":  {"weak": 40,   "avg": 55,   "good": 70,   "elite": 85 },
    "firstBulletAcc":  {"weak": 20,   "avg": 35,   "good": 50,   "elite": 65 },
    # lower is better — stored inverted: elite < good < avg < weak
    "ttk_ms":          {"weak": 900,  "avg": 650,  "good": 450,  "elite": 280},
    "angleControlCount":{"weak": 1,   "avg": 3,    "good": 6,    "elite": 10 },
    "counterStrafeErrors":{"weak": 15,"avg": 8,    "good": 3,    "elite": 0  },
    "reloadErrors":    {"weak": 6,    "avg": 3,    "good": 1,    "elite": 0  },
    "reactionTimeMs":  {"weak": 600,  "avg": 450,  "good": 300,  "elite": 180},
    "overshootCount":  {"weak": 20,   "avg": 12,   "good": 6,    "elite": 2  },
    "excellentContacts": {"weak": 1,  "avg": 3,    "good": 6,    "elite": 10 },
    "crosshairPlacementPct": {"weak": 20, "avg": 35, "good": 50,  "elite": 65 },
    # lower is better
    "passiveAngleCount":  {"weak": 8,    "avg": 4,    "good": 1,    "elite": 0  },
    "successfulReactionTimeMs": {"weak": 550, "avg": 400, "good": 270, "elite": 160},
}
