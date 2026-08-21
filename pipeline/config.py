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
# `n / GENRE_MIN_REACH / 10` games — 33 on the live top 5000. A group of tags
# reaching fewer than that is not a kind of game, and the search stops when
# nothing bigger is left. This does *not* set the number of axes — discovery
# runs to exhaustion; see GENRE_SPOKES for what the radar shows.
GENRE_MIN_REACH = 15
# The second half of that floor, which used to sit inline in `features.py` as a
# bare `/ 10`. Two numbers were multiplied together to make one threshold and
# only one of them had a name, so the effective floor could not be read off the
# config at all.
GENRE_REACH_DIVISOR = 10
GENRE_TOP_SIGNALS = 3     # signals used to name a dimension for display

# How much of a spanning tag's games its compounds must still cover before the
# bare tag may be dropped. A well-definedness guard rather than a dial — the
# nearest other candidates score 81% and 57% and are already excluded for
# anchoring genres of their own — but it is still a magnitude that moves the
# taxonomy, so it belongs here rather than inline in `features.py`.
SPANNING_COVERAGE = 0.90

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

# How many spokes the radar shows. Genres come in two levels: discovery finds
# every natural cluster in the corpus (77 on the live capture) and *all* of them
# are real axes that selection and coverage run on, while the radar shows this
# many named parents, each the exact sum of its children. See
# `features._spokes`.
#
# Nothing is discarded any more. Truncating discovery and then pruning threw
# away 65 of the 77 and scattered their signals: wargame was left split across
# five clusters that never recombined while `Racing` and `Sports` were attracted
# into it, and whole families — dice, dexterity, racing, roll-and-write,
# trick-taking, auction, party — were never seen at all. Deleted clusters did
# not even merge cleanly; `Word Game, Spelling` fragmented, one signal to the
# cooperative genre and one to bluffing.
#
# Keeping all 77 measures better on everything: within-genre game cohesion 2.58x
# -> 3.11x the corpus null, biggest genre 32% -> 15%, and the picks span 52
# distinct genres instead of 12.
#
# The radar is expected to be lopsided, because the corpus is: at twelve the
# spokes run from 30% of all games down to 4%.
GENRE_SPOKES = 12

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
#
# This was `1 / GENRE_LIMIT` back when a fixed number of genres was kept, which
# coincided with an eighth while that limit was eight. Raising it to twelve
# separated them, and the cutoff turns out to
# belong where it was: at twelve genres, 1/8 still measures best (a leading tag
# describes 80% of its genre, against 72% at 1/9, 78% at 1/10 and 65% at 1/12),
# while 1/10 and 1/12 both lose the dexterity genre and 1/7 loses a canary. It
# is a property of how BGG's tag frequencies fall, not of how many genres we
# keep — 625 games separates `Economic` (631) from `Fighting` (602), which is
# the line between "broad kind of game" and "thing games do".
GENRE_BASE_RATE = 0.125

# How much a signal must beat chance for its assigned genre to be tenable. A
# signal that misses is re-homed where it does beat chance most, and dropped
# only if it beats chance *nowhere* — a strictly lower bar, since a home can be
# a bad one without the signal being worthless.
#
# A leftover signal's weight is the share of its games sitting in the genre it
# joined, and that share was never compared against how big the genre is. The
# two largest genres cover 45% and 55% of the corpus, so *any* tag scores about
# half with them by chance alone: `Track Movement` joined the card genre at 0.46
# — a lift of 1.02, precisely chance — and `Race` at 0.56, a lift of 1.24. Both
# then donated "card game" to every game carrying them, which is how Magical
# Athlete came out a card game with no cards in it. The same blindness put
# `Worker Placement` in the wargame genre at a lift of 0.43, below chance, where
# its weight of 0.05 read as "uncrossing-cutting" rather than "wrongly placed".
#
# 1.3 is the strictest cutoff that costs nothing measurable. The 1.2-1.3 plateau
# holds median pick rank at 250 with 3 games unplaced; at 1.4 the median falls
# to 264, and at 1.5 unplaced jumps to 19. Dropping only at chance itself
# (lift <= 1.0) is too weak to catch `Race` at 1.24 and leaves Magical Athlete a
# card game. There is no natural gap to snap to — non-core lift runs 1.37 at the
# lower quartile and 2.16 at the median — so this is a measured cutoff.
#
# Genres keep their own founding signals regardless, so a genre can never be
# stripped of what defines it.
#
# Using this same value for the drop was too aggressive. `Dice` is carried by
# 423 games and its best lift is 1.07 — informative about no genre in
# particular, but not nothing — and discarding it left roll-and-writes with no
# signal for what they are. That's Pretty Clever!, Trek 12 and Monza then came
# out as wargames on the strength of `Dice Rolling + Solo / Solitaire Game`,
# which is mostly about solo wargames. Dropping only below chance restores four
# signals, moves six games out of the wargame genre and changes nothing else.
GENRE_MIN_LIFT = 1.3

# How much tighter a *pair* of tags must be than either tag alone before the
# pair earns a signal of its own. Base-rate compounds exist to split tags too
# big to be a genre; this catches the opposite case — a specific kind of game
# hiding inside two ordinary tags, where neither tag names it.
#
# `Auction / Bidding` is a grab bag and so is `Network and Route Building`, but
# together they are the 18xx family and their games hang together 2.16x better
# than either parent's do. Likewise `Stock Holding + Trains` at 1.78 and
# `Deduction + Voting` at 1.89. Measured as mean pairwise similarity among the
# games carrying both, over the same for whichever parent scores higher.
#
# At 1.7 this admits 24 pairs. Four of them are abstract-strategy pairs, and
# together they found an `Abstract Strategy · Pattern Building` axis — Azul,
# Patchwork, Cartographers, Sagrada, Go — that the corpus has no room for
# otherwise. `Puzzle + Real-time` likewise merges the dexterity and real-time
# families into one axis.
#
# Lower is emphatically not better, because a surviving compound is a genre
# *candidate*, not a refinement: a tag and a compound containing it have high
# cosine by construction, so every extra pair competes to found an axis. At 1.55
# Crokinole becomes a party game and mean name-truth falls to 72%, at 1.45 it
# becomes a voting game at 54%.
#
# This cannot replace GENRE_BASE_RATE, and the two thresholds are not two
# answers to one question. Every one of the 76 base pairs scores *below* this
# bar — the highest is `Cooperative Game + Modular Board` at 1.58 and `Card Game
# + Hand Management` is 1.47 — because a base pair's value is breadth, not
# coherence: it is only modestly tighter than its parents precisely because its
# parents are already coherent (0.350 and 0.329), and what it buys is splitting
# 878 games off the two biggest tags in the corpus. Lowering the bar to reach
# them does not work either, since 1.47 sits in the middle of the distribution
# rather than at a gap: pure interaction at 1.5 admits 137 pairs for 64%
# name-truth, and at 1.3 it admits 539 for 54%. Absolute cohesion does not
# separate them either — base pairs span 0.316-0.546 and interaction pairs
# 0.425-0.762, and catching even half the base pairs means admitting 664 of the
# 1194 candidates.
#
# Dropping the base rule entirely costs the economic genre outright: Brass,
# Terra Mystica, Barrage and Viticulture end up in a 455-game genre named
# `Network and Route Building`, and Agricola in one named `Abstract Strategy`.
GENRE_INTERACTION = 1.7

# When a tag's games stop looking alike once you delete the tag itself, the tag
# was the only thing they shared — it spans several kinds of game rather than
# naming one. Such a tag is represented *only* through its compounds, never on
# its own, so a game is a type of it rather than merely carrying it.
#
# `Worker Placement` is the case this exists for. There are worker-placement
# card games, economic ones and area-control ones, and with a single bare signal
# they were indistinguishable. Its games keep 0.60 of their cohesion without it,
# putting it inside the band the base tags occupy (0.49-0.70) and far from tags
# that name a kind outright — `World War II` keeps 0.92, `Role Playing` 0.91,
# `Miniatures` 0.86. 0.60 is the largest gap in that region of the distribution.
#
# Dropping the bare tag is the whole point and not an implementation detail:
# keeping it alongside the compounds produces exactly the single axis this is
# meant to avoid. Its games fall from 6.3 effective genres to 2.4, with 79% of
# them in one `Worker Placement` genre.
#
# Two further tests keep this narrow, and both are needed. A tag that anchors a
# genre of its own is left alone — `Deduction` and `Party Game` also span, but
# taking their bare tag away concentrates them (6.2 -> 4.0 and 4.7 -> 3.2
# effective genres) rather than spreading them. And a tag whose compounds do not
# cover its games is left alone, because dropping the bare tag would delete the
# concept rather than split it: `Action / Dexterity` has *no* pairing with a base
# tag that reaches the shared-game floor, so its coverage is 0%. Crokinole
# carries three tags and none of them is a base tag. The measure flags dexterity
# for the opposite reason to worker placement — its games share nothing else
# because the tag *is* their kind, not because it spans kinds.
GENRE_SPANS = 0.60

# Contribution of the continuous stats — weight and log-playtime — to distances
# in the feature space, relative to genre loadings. Within a cell weight is
# nearly constant, so genre naturally dominates; this keeps playtime and weight
# as mild tiebreakers.
#
# One dial, not two. They were separate and always equal, which suggested a
# tuning axis that was never used. Note what they actually reach: the matrix
# they scale feeds the 2-D PCA behind the similarity scatter and `MmrScorer`,
# and *nothing else*. Coverage selection reads the genre loadings directly, so
# changing this moves where dots sit on the scatter and does not move a single
# pick.
CONTINUOUS_SCALE = 0.25

# MMR (maximal marginal relevance) selection: each step scores every remaining
# game as  λ·quality + (1-λ)·distance-to-picks  and takes the best. Higher λ
# favours rank; lower λ favours spreading across the space.
MMR_LAMBDA = 0.5
PICKS_PER_CELL = 5        # stop after this many picks per cell

# Probabilistic coverage selection (the default; see pipeline/coverage.py).
# A game covers each genre axis with "probability" quality × loading; a set's
# coverage per axis is 1-∏(1-w); greedy adds whatever fills the most empty
# radar-chart area, stopping when the best remaining gain is below the floor.
# Measured on the live top 5000 by sweeping it against the four numbers, because
# it looks redundant beside QUALITY_EXPONENT — the floor lifts the middle and the
# exponent pushes it down, so they appear to be two dials on one quantity. They
# are not, and the result is the opposite of what the name suggests:
#
#   floor   median   past #1000   canaries   genres/cell   cells changed
#    0.20      267           18        3/4          4.89      — (default)
#    0.10      266           13        3/4          4.80       20 of 35
#    0.05      240           12        3/4          4.80       21 of 35
#    0.00      234           12        4/4          4.71       27 of 35
#
# Removing it *improves* pick quality outright — 33 ranks of median, six fewer
# picks past #1000, and Terraforming Mars comes back — and pays for it in genre
# spread. That is the trade this constant actually makes: lifting the worst-rated
# games is what lets a mediocre game cover a thin axis, and a cell reaches past a
# better-ranked game for the best game of a *kind it lacks*.
#
# So it is a diversity dial wearing a quality dial's name, doing the same job as
# GENRE_REPEAT_PENALTY from the other end. Kept at 0.20 because one game per kind
# is the design; lower it deliberately if pick quality matters more than spread.
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
# (see COLUMN_FLOOR) — it asks "is this what the game is?", not "is this all
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
GENRE_FLOOR = 0.5

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
# How little a game may add and still be shelved. Two ways to decide a shelf is
# full: by count — fill every cell to capacity while candidates remain, which is
# 0 here — or by quality, where a cell stops once nothing worthwhile is left.
#
# It is worth knowing what a low gain actually means, because the name suggests
# "bad game" and it does not. Gain is membership x quality x loading against the
# still-uncovered chart, and membership dominates: Poker scores 0.03 in the
# nine-plus Medium-Heavy cell because its membership *there* is 0.11 — the
# community rates it at lower counts — while Blood on the Clocktower, which
# belongs at 1.00, scores 0.94. At 0.10 the grid stopped 7 slots short of full.
# Measured on the live top 5000, picks per player column:
#
#   floor      1    2    3    4    5   6-8   8+   total   median rank
#   0.00      25   25   25   25   25   25    25     175      267
#   0.10      25   25   25   25   25   25    19     169      248
#   0.20      25   25   25   25   25   25    13     163      234
#   0.30      24   25   25   25   25   25     5     154      215
#
# It is entirely self-targeting: every column but `8+` is untouched until 0.30,
# because `8+` is the only one with barrel-scraping picks to trim. It holds 142
# candidates against 5,577 for the four-player column, and its median gain is
# 0.174 against 0.660 — so forcing five games there shelves whatever is left
# rather than whatever is good. Median pick rank *improves* as the floor rises,
# for the same reason.
#
# This is the data-driven answer to "why does 8+ get as many games as 4?", and it
# is better than a hand-set per-column capacity because it responds to what is
# actually in the corpus rather than going stale when the capture changes. The
# rows do not need it: they are quantiles of the population by construction, so
# they already hold 3,836-5,162 candidates apiece.
#
# Left at 0 so the default grid fills every slot. Raise it to stop shelving
# games that merely reach a cell.
GAIN_FLOOR = 0.0

# How much the rest of the shelf pulls on a cell's choice, as an exponent on
# how new a game is against everything already placed anywhere. Zero ignores the
# collection entirely and each cell is filled in isolation; one weighs the whole
# shelf as heavily as the cell itself.
#
# Filling the cell is the point, so this is deliberately gentle. That the
# collection already holds three deck-builders should make a fourth slightly
# less welcome, not disqualify it — and a second edition of something already
# shelved is the far end of that same idea rather than a separate rule. The
# first round feels none of it, since nothing is shelved yet, so the best game
# for a cell always wins its slot and the pull only builds over later rounds.
#
# Measured on the live top 5000, with `improve_collection` following it: at 0.10
# no re-recording survives anywhere on the grid and median pick rank is 267,
# against 267 and one survivor at 0. Raising it further only costs rank — 0.25
# reaches the same zero at median 276 — so this is set as low as does the job.
#
# It does displace Terraforming Mars, which is the mechanism working rather than
# failing: TM is 0.740 similar to Gaia Project, already shelved, and it competes
# in four of the most crowded cells on the grid against Brass, Ark Nova,
# Gloomhaven and War of the Ring. A second heavy engine-builder is exactly what
# this is meant to make slightly less welcome.
COLLECTION_WEIGHT = 0.10

# How much of a slot's value a replacement must retain before a re-recording is
# swapped out for it — see `assign.improve_collection`. A fraction, not a fixed
# margin, because cell gains span 0.03 to 0.94 and a flat tolerance would mean
# nothing at one end and everything at the other.
#
# Only ever a swap: a cell with nothing to put in the slot keeps what it has.
# At 0.75 the grid trades `7 Wonders (Second Edition)` (retaining 0.75 of the
# slot), `Gloomhaven: Jaws of the Lion` (0.92) and `Ticket to Ride: Europe`
# (0.90), and leaves the Telestrations pair alone because replacing it would
# retain only 0.56.
REPLACEMENT_KEEP = 0.75

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
COLUMN_FLOOR = 0.25   # drop columns scoring below this fraction of the peak

# How much a "this works" vote counts against a "this is the best" vote. A
# count's score is (best + RECOMMENDED_WEIGHT * recommended) / total votes.
# Best votes alone are a preference ordering, not a verdict: a vote for four
# players is a vote taken away from five. Cartographers plays well at five by
# 92% approval against 97% at four, but scored 108 Best against 248 and came out
# at 0.44. At 0.25 it reaches 0.67.
#
# A quarter was too harsh, and was doing a second job it should not have been.
# Concordia at five is 93 Best / 357 Recommended / 107 Not — four voters in five
# call it good or better — and scored 0.43, so the fifth-player column treated
# it as barely playable. Counting Recommended at half puts it at 0.58 while El
# Grande, which really is a five-player game (79% Best, 3% Not), keeps 1.00
# against 0.78 at four.
#
# What a quarter was silently buying is now bought explicitly by the
# majority-negative guard in `buckets.player_memberships`: counts most voters
# reject used to be excluded only because they landed under COLUMN_FLOOR at
# this weight, which is why raising it alone drags crowd games across the grid
# (Cartographers' nine-plus row, 104 Not against 17 Best, appears at 0.34).
# With the guard doing that job, columns per game rise only 3.07 -> 3.20 rather
# than 3.34, and median pick rank improves 250 -> 244 with all four canaries.
#
# Half is the top of the safe range: at 0.6 Terraforming Mars stops being
# picked.
RECOMMENDED_WEIGHT = 0.5

# Weight rows are quantile cuts, so a game at 2.89 is barely distinguishable from
# one at 2.91. Membership stays 1.0 inside a row and tapers to 0 across this many
# weight units past each edge, letting borderline games belong to both.
WEIGHT_TAPER = 0.15

# Cells below this combined (column x row) membership aren't worth considering.
CELL_FLOOR = 0.05
COLLECTION_SIZE = 15      # default target size for the collection builder

# --- Presentation ------------------------------------------------------------
#
# Display only: none of these changes a single pick. They were scattered across
# `collection.py` and `features.py`, which made them invisible to anyone reading
# this file to find out what could be tuned.

# An axis covered below this is *reported* as a gap, with the best games to fill
# it. Affects what an audit says, never what selection does.
GAP_THRESHOLD = 0.5
SUGGESTIONS_PER_GAP = 3

# How many genres to name per game in the output, and the smallest loading worth
# showing at all — a game's radar is long-tailed and the tail is noise.
GENRES_SHOWN_PER_GAME = 3
MIN_LOADING_SHOWN = 0.05
