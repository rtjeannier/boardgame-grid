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

# BGG's official ranks dump (https://boardgamegeek.com/data_dumps/bg_ranks) —
# the id-in-rank-order source the live fetch walks. It replaces the old scrape
# of the HTML browse pages, which Cloudflare now answers with 403.
RANKS_CSV = ROOT / "data" / "boardgames_ranks.csv"

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

# --- Feature space & coverage selection --------------------------------------
#
# Games are embedded in a continuous space (see pipeline/features.py): latent
# genre dimensions factored out of the mechanic/category matrix, plus weight
# and playtime. Per-cell selection then maximises coverage of that space.

NMF_COMPONENTS = 10       # how many latent genre dimensions to factor out
GENRE_TOP_SIGNALS = 3     # signals used to name a dimension for display

# Contribution of the continuous stats to distances, relative to genre loadings
# (which are L2-normalised per game). Within a cell weight is nearly constant,
# so genre naturally dominates; these keep playtime/weight as mild tiebreakers.
WEIGHT_SCALE = 0.25
PLAYTIME_SCALE = 0.25

# MMR (maximal marginal relevance) selection: each step scores every remaining
# game as  λ·quality + (1-λ)·distance-to-picks  and takes the best. Higher λ
# favours rank; lower λ favours spreading across the space.
MMR_LAMBDA = 0.5
PICKS_PER_CELL = 5        # stop after this many picks per cell

# Probabilistic coverage selection (the default; see pipeline/coverage.py).
# A game covers each genre axis with "probability" quality × loading; a set's
# coverage per axis is 1-∏(1-w); greedy adds whatever fills the most empty
# radar-chart area, stopping when the best remaining gain is below the floor.
QUALITY_FLOOR = 0.2       # worst-rated game still covers this fraction of its loadings

# How sharply a better rating beats a worse one. `quality` normalises BGG's
# Bayesian average across the population and raises it to this power, so >1
# widens the gap between the top and the middle. Needed because the rating band
# is narrow — #1 scores 8.39 and #5000 scores 5.79 — and rank position is worse
# still: it is a dense ordering of that same narrow band.
QUALITY_EXPONENT = 2.0

# Retuned from 0.15 when loadings moved from L2 to L1 normalisation: every game
# now carries total mass 1.0 rather than ~2.2, so gains shrank by about that
# factor and the floor follows them down.
GAIN_FLOOR = 0.10         # stop picking when the best marginal gain drops below this

# Duplicate suppression. A candidate's gain is scaled by
# (1 - similarity_to_nearest_pick ** SIMILARITY_EXPONENT), where similarity is
# cosine over centrality-weighted tags (see features._similarity_space). The
# exponent is the falloff sharpness: near-flat through the middle so games that
# merely share a genre keep their value, collapsing at the top so two games with
# the same core cannot both claim the space.
#
# Retuned 2 -> 3 when similarity moved to centrality weighting, which lifted the
# whole scale — an unrelated 95th-percentile pair now scores 0.47, where an
# exponent of 2 would shave 22% off it. At 3 that bulk loses 10% while a
# same-core pair at 0.84 is still suppressed by 59%.
SIMILARITY_EXPONENT = 3

# How much evidence a game needs before we believe its genre split. BGG's tag
# counts track popularity, not simplicity — rank and tag count correlate -0.35,
# and the bottom of the top 5000 carries half the tags of the top 250 — so a
# thinly-tagged game is usually unread rather than genuinely focused. Loadings
# are therefore blended toward "unknown" (flat across every genre) in proportion
# to how little attention a game has had:
#
#     shrunk = (ratings * observed + KAPPA * flat) / (ratings + KAPPA)
#
# A game keeps half its claim at KAPPA ratings. Weighting by *ratings* rather
# than tag count is the point: SCOUT has four tags and 29k ratings, so it is
# genuinely just a card game and keeps 94%; a one-tag game with 494 ratings
# keeps 20%. Tag-count weighting would punish both alike.
LOADING_SHRINKAGE = 8000

# --- Soft cell membership ----------------------------------------------------
#
# A game does not sit in one cell; it belongs to several by degree. Columns come
# from the player-count poll (see buckets.player_memberships), rows from a taper
# around the quantile edges. Membership then scales the game's coverage
# contribution, so a game centred in a cell outranks one that merely reaches it.

# Column membership is *peak-relative*: the game's best column scores 1.0 and the
# rest are measured against it. So a game uniformly great at 3-6 players scores
# 1.0 in all four columns. Scoring by share-of-total would instead give it 0.25
# each and let a mediocre 4-only game beat it, which penalises versatility.
MEMBERSHIP_FLOOR = 0.25   # drop columns scoring below this fraction of the peak

# How much a "this works" vote counts against a "this is the best" vote. A
# count's score is (best + RECOMMENDED_WEIGHT * recommended) / total votes.
# Best votes alone are a preference ordering, not a verdict: a vote for four
# players is a vote taken away from five. Cartographers plays well at five by
# 92% approval against 97% at four, but scored 108 Best against 248 and came out
# at 0.44. At 0.25 it reaches 0.67, while Ricochet Robots' eleven-player row —
# tolerated but not liked — stays at the floor. Counting Recommended in full
# would put that at 0.57 and drag every crowd game across the whole grid.
RECOMMENDED_WEIGHT = 0.25

# Weight rows are quantile cuts, so a game at 2.89 is barely distinguishable from
# one at 2.91. Membership stays 1.0 inside a row and tapers to 0 across this many
# weight units past each edge, letting borderline games belong to both.
WEIGHT_TAPER = 0.15

# Cells below this combined (column x row) membership aren't worth considering.
CELL_MEMBERSHIP_FLOOR = 0.05
COLLECTION_SIZE = 15      # default target size for the collection builder
