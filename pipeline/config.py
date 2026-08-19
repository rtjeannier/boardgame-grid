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

# The smallest genre worth having: one tenth of an even share, so
# `n / GENRE_AXIS_TARGET / 10` games — 33 on the live top 5000. A group of tags
# reaching fewer than that is not a kind of game, and the search stops when
# nothing bigger is left. This does *not* set the number of axes; see
# GENRE_LIMIT.
GENRE_AXIS_TARGET = 15
GENRE_TOP_SIGNALS = 3     # signals used to name a dimension for display

# Dimension names join their signals with this, and it doubles as the mark
# between the halves of a compound tag (`Card Game · Hand Management`). It
# cannot be " / ": BGG tag names contain that string ("Action / Dexterity",
# "Murder / Mystery"), and the frontend splits on it to take a spoke's primary
# label — which would render the dexterity axis as "Action".
# web/src/{Radar,Detail,Collection}.jsx split on it.
GENRE_NAME_SEPARATOR = " · "

# Joins the two halves of a compound signal. Distinct from the separator above
# so a genre's name can be built from the distinct tags its signals mention.
GENRE_COMPOUND = " + "

# How much a genre's signals must actually co-occur, as mean pairwise cosine.
# The main lever on how many genres come out: at 0.05 the corpus settles at five
# (dexterity gets folded in with real-time), at 0.10 six, at 0.15 nine, at 0.20
# ten but only 92% of games end up in any genre at all.
GENRE_MIN_COHESION = 0.10

# How much of its starting tightness a genre may lose as it grows. Each genre
# starts from the most cohesive group left and widens while it holds this share
# of that. Relative because genres differ in how tight they naturally are —
# `Wargame · Simulation` opens at 0.63 and dexterity at 0.48, so a fixed bar
# either strangles dexterity or lets the card-game cluster swell to 86% of the
# corpus.
GENRE_GROWTH = 0.4

# How many genres to keep. Discovery yields about 18; the rest are pruned by
# `features._prune_nested`, which drops whichever genre most lives inside
# another. That order matters: by size or by tightness the small distinctive
# genres go first (dexterity is 124 games, cohesion 0.48), whereas by
# containment the redundant sub-genres go — `Modern Warfare` is 94% inside the
# wargame genre — and dexterity survives all the way down to six.
#
# The radar is expected to be lopsided, because the corpus is: at eight the
# genres run from 50% of all games down to 3%.
GENRE_LIMIT = 8

# How many genres to discover before pruning. Left to run, the search keeps
# splitting until the tag pool empties — about 40 — and the extra genres are
# real but marginal (`Trivia`, `Move Through Deck`). Discovering more is not
# free: pruning then has more candidates to keep and drops different ones, and
# at 24 and 40 the surviving eight lose Economic and Sports to those marginals.
# Eighteen is where the survivors are the recognisable kinds.
GENRE_DISCOVER = 18

# A tag carried by more of the corpus than one genre's even share cannot itself
# be a genre — it is a base rate. `Hand Management` marks 1634 of 5000 games and
# `Card Game` 1483; left to found genres they anchor one covering most of
# everything. Such tags are *additionally* offered paired with each other
# (`Card Game + Hand Management`), which is specific enough to name a kind of
# game where neither half was.
#
# Derived rather than tuned. It was a hand-picked 0.20, which is arbitrary and
# was arbitrary in a way that mattered: `Solo / Solitaire Game` is 19.1% of the
# corpus, so it missed by four tenths of a point and anchored a genre covering
# half of everything, while catching it meant threading between `Solo` (954
# games) and `Open Drafting` (950) — a threshold decided by four games.
#
# The relationship is not monotonic, so this is the right rule and not a smooth
# dial: 1/6 and 1/10 both give worse genre sets than 1/8.
GENRE_BASE_RATE = 1 / GENRE_LIMIT

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

# Quality is judged against a game's own genre, not the whole corpus, and this
# says who counts as being in a genre: any axis carrying at least this share of
# the game's strongest one. Peak-relative for the same reason the player axis is
# (see MEMBERSHIP_FLOOR) — it asks "is this what the game is?", not "is this all
# the game is", so a game with two real genres belongs to both.
#
# Without this the dexterity axis could never fill. Crokinole *is* the best
# dexterity game there is, but rated against all 5000 games a 7.80 scores 0.68,
# and no dexterity game rates 8.39 — so the genre's bar was unreachable no
# matter what you owned, and the same held for every genre without a top-ten
# game in it. Judged among dexterity games Crokinole scores 1.0, and its bar
# reads 0.92 instead of 0.63.
#
# Only the genre's *leader* is lifted, which is why this is affordable: dividing
# every weight by the axis best instead inflates mediocre games on thin axes
# too, and cost 100 ranks of median pick quality while dropping Ark Nova and
# Terraforming Mars from the grid. This costs 12 ranks and drops nobody.
GENRE_MEMBERSHIP_FLOOR = 0.5

# How much a genre's scarcity counts in its favour, as an exponent on genre
# size — IDF over genres. Without it a crowded genre wins on sheer volume: a
# game sitting between the card-game genre and the much smaller train genre goes
# to the card game every time, and only 23% of the games carrying the train
# genre's own signals were classified as train games (Ticket to Ride Legacy came
# out a card game). At 0.5 that rises to 34%, the biggest genre shrinks from 51%
# of the corpus to 40%, and median pick rank improves 287 -> 252.
#
# Square-root, chosen not derived. At 0.25 the effect is too weak to reclassify
# Ticket to Ride; at 0.75 the crowded genres start losing games they should keep
# (the co-op genre's recall falls to 37%). Set to 0 to restore flat weighting.
#
# This is the same idea as `coverage.genre_quality` — scarce is worth more —
# applied to membership rather than to quality. Between them, a small genre gets
# an axis worth filling and its best game scores full marks for filling it.
GENRE_SCARCITY = 0.5

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

# What a second game of the same primary genre is worth to a cell, relative to
# the first. A cell is meant to show the best game of each *kind*, and coverage
# alone does not deliver that: it treats a genre as a quantity to fill, so once
# Dune: Imperium covers the card-game axis to 0.404 there is still 0.60 "left"
# for Lost Ruins of Arnak to claim by being the same sort of game again — the
# two came out first and third in one cell.
#
# This matters more the more lopsided the radar is. Half the top 5000 is
# primarily co-op/adventure/campaign — genuinely, not as an artefact; those tags
# overlap 33-46% and the games are Gloomhaven, Arkham Horror, Sleeping Gods —
# so without a penalty that one genre takes two slots in most cells simply by
# being numerous. It accounted for 21 of 27 repeated cells.
#
# A *preference*, not a ban, so a cell whose candidates cannot field five genres
# still fills rather than leaving slots empty. The exact value barely matters:
# 0.5 and 0.0 give identical grids, because the repeats being displaced are
# top-30 games that either win outright or lose outright. Cells repeating a
# genre fall from 27 of 34 to 1, distinct genres per cell rise 3.79 -> 4.63, and
# median pick rank goes 245 -> 278 as cells reach past a second Terraforming
# Mars for the best game of a kind they lack.
GENRE_REPEAT_PENALTY = 0.35

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
