"""Grid configuration: the two axes and where output goes.

Everything a human might want to tweak lives here so the rest of the
pipeline stays declarative. Change these values and re-run the build.
"""

from pathlib import Path

# --- Paths ------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
# The frontend reads this file. Vite copies web/public/* into the built site,
# so writing here means "npm run build" ships the latest grid automatically.
OUTPUT_JSON = ROOT / "web" / "public" / "grid.json"
CACHE_DIR = ROOT / "data" / "cache"  # raw BGG responses, keyed by id

# Datasets are the hand-off between fetching and building. Both files share one
# schema (see pipeline/dataset.py); the build consumes whichever it's pointed
# at. `games.seed.json` is a committed proxy; `games.json` is the live capture.
SEED_DATASET = ROOT / "data" / "games.seed.json"
LIVE_DATASET = ROOT / "data" / "games.json"

# --- Axis 1: player count (columns) -----------------------------------------
#
# A game lands in a column when the community's "best/recommended player count"
# poll includes a number in that column's range. `hi = None` means open-ended.
# Ranges may overlap in intent but are kept disjoint here so 8 sits in "6-8"
# and only 9+ falls into "8+".
PLAYER_COLUMNS = [
    {"label": "1", "lo": 1, "hi": 1},
    {"label": "2", "lo": 2, "hi": 2},
    {"label": "3", "lo": 3, "hi": 3},
    {"label": "4", "lo": 4, "hi": 4},
    {"label": "5", "lo": 5, "hi": 5},
    {"label": "6-8", "lo": 6, "hi": 8},
    {"label": "8+", "lo": 9, "hi": None},
]

# --- Axis 2: complexity / weight (rows) -------------------------------------
#
# BGG weight runs 1.0 (light) to 5.0 (heavy) but is very lopsided: almost no
# games sit above ~4.3. So instead of fixed cut points we slice the *actual*
# population into equal-sized quantile buckets (see pipeline/buckets.py). This
# is how many rows to make.
WEIGHT_ROW_COUNT = 5

# Cosmetic, *relative* names for the rows, lightest first. Because rows are
# equal-sized quantiles, these read as "the lightest fifth" ... "the heaviest
# fifth" — the numeric edges from the data remain the source of truth. The
# ladder is sliced to WEIGHT_ROW_COUNT; extra rows fall back to "Tier N".
WEIGHT_ROW_LADDER = ["Gateway", "Light", "Medium", "Medium-Heavy", "Heavy", "Brain-burner"]

# How many extra "runner-up" games to keep per cell for exploration. These are
# the games that lost their archetype slot but are still worth seeing.
ALTERNATES_PER_CELL = 6
