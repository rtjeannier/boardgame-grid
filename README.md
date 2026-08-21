# Board Game Grid

Curate a board-game collection as a 2-D grid:

- **Columns — player count:** `1, 2, 3, 4, 5, 6-8, 8+`
- **Rows — complexity/weight:** data-mined quantile buckets, so each row holds a
  comparable number of games instead of a near-empty "heavy" row.
- **Inside each cell:** a subset chosen for *coverage* of a continuous game
  space — no two near-identical games, however well-ranked both are.

Games live in an n-dimensional feature space: **genre axes** discovered by
clustering BGG's mechanic/category tags (a game isn't "a deck builder", it's
0.7 deck-building / 0.4 worker-placement), plus weight and playtime.
Selection fills a radar chart over those genre axes, so every cell shows the
best game of each *kind* without anyone hand-defining the kinds — and the same
math powers a **collection builder**: anchor games you love, fill the rest by
coverage, and see the gaps.

The output is an interactive static site you can host on GitHub Pages.

![grid preview](web/public/preview.png)

## How it fits together

```
pipeline/            Python — two independent steps joined by a dataset file
  fetch.py           live BGG capture  -> data/games.json      (touches network)
  build.py           dataset           -> web/public/grid.json (no network)
  dataset.py         the dataset file format (load/save)
  client.py          live BGG XML API2 client (cached), used by fetch
  config.py          the two axes + tunables (edit me first)
  features.py        the continuous feature space (tag clusters -> genres -> vectors)
  coverage.py        the radar-chart coverage maths (no selection)
  assign.py          one allocator over any axes + swappable Scorers
  collection.py      the same allocator with no axes: anchors, gap analysis
  archetypes.py      hand-written taxonomy, only for --assigner greedy
  buckets.py         Axis protocol; player-count + quantile-weight axes
data/
  games.seed.json    committed proxy dataset (same shape as a live capture)
  games.json         live capture (git-ignored, made by fetch)
web/                 Vite + React explorer, builds into ../docs
docs/                the built site GitHub Pages serves
```

The pipeline is two decoupled stages with a **dataset** in the middle:

```
fetch.py ──▶ data/games.json ─┐
                              ├─▶ build.py ──▶ grid.json ──▶ web
data/games.seed.json ─────────┘
```

`build.py` only ever *consumes a dataset* — it has no idea whether the games
came from a live capture or the seed proxy. Both files share one schema
(`source`, `generatedAt`, `games[]`), so switching data sources is nothing more
than pointing the build at a different file. The seed proxy carries every field
a live capture would, `best_count` included, so no stage has to guess.

## Run it

**Build the grid from the committed seed proxy (no network):**

```bash
pip install -r requirements.txt     # numpy + scikit-learn power the feature space
python -m pipeline.build            # reads data/games.seed.json -> grid.json
python -m pipeline.build --assigner mmr      # distance-based alternative
python -m pipeline.build --assigner greedy   # archetype-taxonomy baseline
```

**Measure a change (the four numbers):**

```bash
python -m pipeline.build --report                 # seed data
python -m pipeline.build --report --dataset data/games.json
python -m pipeline.build --output /tmp/grid.json  # measure without touching the committed grid
```

Every genre or selection change in this repo is judged on the same four numbers,
so comparisons hold across changes:

- **Cohesion** — do a genre's games actually resemble each other, as a multiple
  of the corpus null? The unbiased one: it does not care what a genre is called.
- **Name-truth** — does a genre's leading tag describe its members? Measured per
  *axis*, since a spoke sums several axes and is named after one of them.
  Biased toward genres named after one dominant tag, which is why cohesion sits
  beside it.
- **Median pick rank**, and how much of the shelf sits past #1000.
- **Slots filled.**

Four canaries — Ark Nova, Terraforming Mars, Wingspan, Brass: Birmingham — are
reported alongside as a smoke test. A canary dropping out can be *correct*:
Terraforming Mars is 0.740 similar to Gaia Project, already shelved, and
`COLLECTION_WEIGHT` exists precisely to make a second heavy engine-builder less
welcome. Check why before treating it as a regression. `tests/golden/baseline.md`
records the current reading for both datasets.

**Run the tests:**

```bash
pytest tests/                        # ~5s, seed dataset only
python -m tests.regenerate_golden    # after a change that is *meant* to move picks
```

`tests/golden/seed_picks.json` pins what every cell shelves and what it was
worth. Everything runs against the seed, because `data/games.json`,
`data/cache/` and `boardgames_ranks.csv` are gitignored and the seed is the only
dataset a fresh clone can reproduce.

**Build or evaluate a collection (the Collection tab):**

```bash
python -m pipeline.collection --anchors "CATAN" --size 15   # fill around anchors
python -m pipeline.collection --anchors "CATAN" --evaluate  # gaps only, no filling
```

**Refresh from live BoardGameGeek data (two steps):**

Two one-time prerequisites — the XML API now answers unauthenticated requests
with `401`, and it has no "give me the top N" call:

1. Create an API token at [using_the_xml_api](https://boardgamegeek.com/using_the_xml_api)
   and export `BGG_API_TOKEN` (plus `BGG_USER_AGENT` identifying you and a
   contact address). The devcontainer forwards both from the host, so the
   secret never lands in the repo.
2. Download `boardgames_ranks.csv` from
   [data_dumps/bg_ranks](https://boardgamegeek.com/data_dumps/bg_ranks) and
   unzip it into `data/`. It supplies the ids *in rank order*; it's git-ignored
   because it's 11 MB and BGG regenerates it regularly.

```bash
python -m pipeline.fetch --limit 1000           # -> data/games.json
python -m pipeline.build --dataset data/games.json
```

`fetch` reads the ranks dump, hydrates each game via the XML API2 (weight, the
community best-player-count poll, mechanics, categories, `Game:` families) and
caches every response under `data/cache/` — so a re-run re-parses from disk
without touching the network. `build` is unchanged either way.

**Build the site:**

```bash
cd web
npm install
npm run build        # emits the static site into ../docs
npm run dev          # or run it locally with hot reload
```

## Publish on GitHub Pages

Repo **Settings → Pages → Build and deployment → Deploy from a branch**, then
pick this branch and the **`/docs`** folder. The site goes live at
`https://<user>.github.io/<repo>/`.

## The feature space and selection

`pipeline/features.py` embeds every game:

1. Game × signal incidence matrix from BGG mechanic/category names.
2. The *signals* are clustered by co-occurrence, and each cluster becomes one
   genre axis, named after the tags that define it — `Wargame · Simulation ·
   World War II`, `Action / Dexterity · Stacking and Balancing`. Nobody labels
   the genres; they are read off the data.

   **Base-rate tags get compounds.** A tag carried by more than
   `GENRE_BASE_RATE` of the corpus cannot itself be a genre. `Hand Management`
   marks 1634 of 5000 games and `Card Game` 1483, and left to found genres they
   anchor one covering most of everything. So every *pair* of such tags also
   becomes a signal (`Card Game + Hand Management`), specific enough to name a
   kind of game where neither half was; several genres exist only because of
   them. Ordinary tags are not paired wholesale — doing that shreds them into
   fragments that only recombine into themselves.

   **A few pairs earn a signal by interaction instead** (`GENRE_INTERACTION`),
   answering the opposite question: is a specific kind of game hiding inside two
   *ordinary* tags, where neither names it? A pair qualifies when its games hang
   together far better than either tag's do alone — `Auction / Bidding` is a
   grab bag and so is `Network and Route Building`, but together they are the
   18xx family, 2.16× tighter than either parent. Twenty-four pairs clear the
   bar, and four of them are abstract-strategy pairs that between them found the
   `Abstract Strategy · Pattern Building` axis (Azul, Patchwork, Go, Sagrada).
   The bar is high on purpose: a surviving compound is a genre *candidate*, not
   a refinement, so every extra pair competes to found an axis.

   **A tag that spans kinds is represented only by its compounds**
   (`GENRE_SPANS`). Worker placement is not one thing — there are
   worker-placement card games, economic ones and area-control ones — so it is
   paired like a base tag and its bare form is dropped, leaving a game as a
   *type* of worker placement rather than merely carrying the tag. A tag
   qualifies when its games stop looking alike once the tag is deleted from
   them, and only if it anchors no genre of its own and its compounds still
   cover its games. That last test is what keeps `Action / Dexterity` out:
   Crokinole carries three tags and none is a base tag, so no dexterity compound
   exists and dropping the bare tag would erase the concept rather than divide
   it.

   The base tags are otherwise **kept** alongside their compounds. A tag
   connects every game carrying it; a compound connects only games sharing that
   exact pair, and
   games pair the same tag differently — Dune: Imperium and Lost Ruins of Arnak
   both carry `Open Drafting`, but Dune pairs it with `Solo`/`Variable Player
   Powers` and Arnak with `Card Game`/`Fantasy`/`Hand Management`. Dropping the
   parent halves how alike a tag's games look to each other, for all thirteen
   base tags, with none spared. Compounds add specificity; only the parent
   carries commonality.

   **Genres are then claimed tightest-first.** Each round agglomerates whatever
   signals are unclaimed, takes the most cohesive group that reaches enough
   games, grows it while it holds `GENRE_GROWTH` of the tightness it started
   with, and removes it from the pool. Taking the tightest thing first is what
   stops a genre being founded on a seed and then accreting: selecting by
   coverage instead let a two-tag `Set Collection · Open Drafting` seed grow
   into a 1142-game genre by absorbing hand management, worker placement and
   deck building, none of which its name mentions.

   **Nothing is discarded; the axes are grouped instead.** Discovery runs until
   the tag pool empties — 77 clusters on the live capture — and every one is a
   real axis that selection and coverage run on. For the radar they are grouped
   into `GENRE_SPOKES` named families, each family the plain sum of its members,
   so the chart aggregates the vectors the picker scored rather than computing
   anything of its own.

   Truncating discovery and pruning the rest is what this replaced, and it threw
   away 65 of the 77. Wargame was left split across five clusters that never
   recombined while `Racing` and `Sports` were attracted into it — which is how
   Flamme Rouge and Long Shot: The Dice Game came out as wargames — and whole
   families were never seen at all: dice, dexterity, racing, roll-and-write,
   trick-taking, auction, party. Deleted clusters did not even merge cleanly:
   `Word Game · Spelling` fragmented, one signal to the cooperative genre and
   one to bluffing. Keeping all 77 raises within-genre game cohesion from 2.58x
   the corpus null to 3.11x, drops the biggest genre from 32% to 15%, and the
   picks span 52 distinct genres instead of 12.

   Families are grouped by the **games** they describe, not by their signals.
   Grouping on signals chains: the big clusters bridge everything and one family
   ends up holding 96% of the corpus.

   **Genres are named by what they describe**, not by what is exclusive to them.
   A tag's label score is the harmonic mean of how much of the tag lands in the
   genre and how much of the genre carries the tag, so a name has to be about
   this genre *and* about most of its members. Precision alone crowns whatever
   is rarest — it named the party genre `Voting`, a tag 21% of it carries, and
   the dexterity genre `Stacking and Balancing`, also 21%.

   **The radar is lopsided on purpose**, because the corpus is: the twelve
   genres run from 31% of all games down to 2%. Twelve rather than eight because
   at eight the thematic region — fantasy, adventure, dice, miniatures, solo,
   co-op — collapsed into one 38% genre whose leading tag described 44% of its
   own members, so Root and Five Tribes were filed as cooperative games. Every
   build prints the worst containment so redundancy stays visible.

   **Scarce genres are weighted up** (`GENRE_SCARCITY`), so a game leaning
   equally on a crowded genre and a rare one counts as the rare one. This is IDF
   over genres, and without it a crowded genre wins on sheer volume: only 23% of
   the games carrying the train genre's own signals were classified as train
   games, and Ticket to Ride Legacy came out a card game. At 0.5 that rises to
   34%, the biggest genre shrinks from 51% of the corpus to 40%, and picks
   distribute far more evenly — genres spanning 40% down to 5% of all games get
   25, 25, 25, 27, 18, 22, 13 and 7 picks respectively.

   It is the same idea as the quality model's "judge a game within its own
   genre", applied to membership rather than to quality. Between them, a small
   genre gets an axis worth filling and its best game scores full marks for
   filling it.

   Tags outside the chosen genres join whichever they most resemble, and they
   move in *coherent blocs* rather than one at a time — placing them
   individually tore dexterity apart, sending `Action / Dexterity` to dice
   rolling and `Stacking and Balancing` to tile laying. A bloc goes where it fits
   best *per tag already there*, so the biggest genre does not swallow every
   leftover simply by being nearest to everything.

   The axes follow the *corpus*: the committed top-5000 capture yields
   `Action / Dexterity`, `Real-time` and `Deduction · Murder / Mystery`, while a
   smaller slice spends its axes differently. This replaced an NMF
   factorisation, which could not name an axis honestly (Wingspan's top genre
   came out as "Line of Sight / Miniatures") and could not find a genre below
   ~150 games at any component count, leaving dexterity (120 games) and
   trick-taking (89) with no axis at all.
3. A game's vector = normalised genre loadings + mildly scaled weight and
   log-playtime. A global 2-D PCA of these vectors feeds the per-cell
   similarity scatter in the site's detail drawer.

   Loadings are **L1-normalised**: every game carries the same *total* genre
   mass, so the vector says how a game divides itself between genres, not how
   much genre it has. This matters because coverage sums across axes. Under L2
   the sum of *squares* is fixed, so a game touching k axes carries √k mass —
   3.16× for a ten-axis sprawl, which exceeds the entire 2.5× range of
   `quality`. A bottom-ranked generalist then outscores a #1 specialist and rank
   can never catch up.

### Where a game sits: membership, not a single home

A game does not live in one cell. Both axes are fuzzy, and a game belongs to
several cells *by degree*:

- **Columns** come from the suggested-players poll. A count scores its
  *approval share* — `(best + RECOMMENDED_WEIGHT × recommended) / votes` — not
  its share of Best votes, because Best alone is a preference ordering: a vote
  for four players is a vote taken away from five. Cartographers plays well at
  five by 92% approval against 97% at four, yet its Best votes (108 vs 248)
  made it look like a 44% five-player game.

  All three vote types count, and none is a substitute for another. Recommended
  is a weak yes, discounted rather than counted in full — treated as equal to
  Best it makes Concordia as much a three-player game as a four (255 Best
  against 451). Not Recommended is a real no: it dilutes the share *and* vetoes
  the count outright when it carries a majority, which is what keeps
  Cartographers (104 Not against 17 Best at nine-plus) out of the crowd column.

  Columns are then **peak-relative**: the strongest is 1.0 and the others
  measure against it, so a game the community likes equally at 3, 4, 5 and 6
  scores 1.0 in all four — versatility is not punished. (Scoring by
  share-of-total would give it 0.25 apiece and rank it below a mediocre game
  playable only at 4.)
- **Rows** taper: full membership inside a row, falling to zero across
  `WEIGHT_TAPER` weight units past each edge. The edges are quantile cuts, and
  BGG publishes only a mean weight, so 2.89 and 2.91 are not different games.

Cell membership is the product of the two, and it scales the game's coverage
contribution — so a game centred in a cell counts fully and one that merely
reaches it counts less.

### Coverage selection (the default)

Picture a radar chart with one spoke per genre dimension. Each game covers
every axis with "probability" `membership × quality × loading`, and a set of
games covers an axis unless all of them miss it:

```
coverage(axis) = 1 − ∏(1 − wᵢ)
```

`quality` comes from BGG's **Bayesian average**, and it is judged *within each
genre* — a game is scored against the games that share that genre, so a genre's
best game covers it fully. Scored against the whole population instead, a genre
whose best game is merely very good could never be covered at all: Crokinole is
the finest dexterity game there is and rates 7.80 where the population tops out
at 8.39, so it scored 0.68 and the dexterity axis sat two thirds empty no matter
what you owned. The ceiling was BGG's rating spread, not the collection. Judged
among dexterity games it scores 1.0 and fills its bar.

Only the genre *leader* is lifted this way, which is what makes it affordable.
Dividing every weight by the axis's best game instead inflates mediocre games on
thin axes too, and cost 100 ranks of median pick quality while dropping Ark Nova
and Terraforming Mars off the grid; this costs 12 ranks and drops nobody.

Genre membership is peak-relative (`GENRE_MEMBERSHIP_FLOOR`), so a game counts
towards every genre that is a real part of it. Note this is within *genre*,
never within *cell* — a game's genres belong to the game, so its weights don't
move with whatever else lands beside it, and scores stay comparable across cells
(which contests depend on). A percentile would flatten the top instead: in an
857-game cell spanning ranks 3 to 4991, Orléans (#35) and Rajas of the Ganges
(#170) both scored top-5% at 0.996 and 0.975, so a 135-place gap was worth 0.02.
`QUALITY_EXPONENT` sets how sharply a better rating wins, because the rating
band itself is narrow — 8.39 at #1 down to 5.79 at #5000.

So Dominion (0.7 deck-building) covers that axis to 0.7; adding Star Realms
(0.6) only lifts it to 0.88 — near-duplicates have tiny marginal value.

Because games belong to several cells, selection is **grid-wide**: a game is
picked at most once anywhere, and something has to decide which cell gets a
contested one. Allocation runs in rounds — every cell bids for its best
remaining game, a contested game goes to whichever cell gains most, losers
re-bid, and nothing commits until the round ends. So **every cell takes its
first pick before any cell takes its second**, and a thin cell can't be picked
clean by a well-stocked neighbour helping itself repeatedly. A repair pass
afterwards moves a game if some cell with room would gain more from it.

**Every round is scored the same way, including the first.** The opening pick
used to be forced to the best-ranked game, because under L2-normalised loadings
a game's value against an empty cell grew with how many genres it touched.
Under L1 an empty cell's best bid is already its best-rated, best-fitting game,
so forcing rank on top only overrode membership.

A cell fills to capacity while candidates remain. `GAIN_FLOOR` is the other way
to decide a shelf is full — stop once nothing worthwhile is left — and it is
worth knowing that a low gain mostly means *this game barely reaches this cell*,
not *this game is bad*: Poker scores 0.03 in the nine-plus Medium-Heavy cell
because its membership there is 0.11, while Blood on the Clocktower, which
belongs at 1.00, scores 0.94.

**The cell comes first, the collection second.** Filling a cell well is the
goal; that the shelf already holds three deck-builders only makes a fourth
slightly less welcome, wherever it sits (`COLLECTION_WEIGHT`). Because every
cell takes its first pick before any cell takes its second, the opening round
feels none of this — the best game for a cell always wins its slot — and the
pull only builds over later rounds.

**Re-recordings are swapped out, siblings are not.** Two games in a family are
not the same game: `Wingspan Asia` brings `Economic` and `Push Your Luck`,
`Codenames: Duet` brings `Cooperative Game`, and both keep their slots. What
marks a re-recording is containment — every tag on `7 Wonders (Second Edition)`
is already on `7 Wonders`, so nothing here can tell them apart. Those are
swapped for the best free candidate in the same cell, and only when one exists
(`REPLACEMENT_KEEP`), so a cell is never emptied for the sake of tidiness.

**One game per kind.** That formula treats a genre as a *quantity to fill*
rather than a kind to represent, so a second game of the same kind still gets
paid for whatever the first left over: Dune: Imperium covers the card-game axis
to 0.404, leaving 0.60 "unfilled" for Lost Ruins of Arnak to claim, and the two
came out first and third in one cell. So a cell strongly prefers not to take two
games sharing a primary genre (`GENRE_REPEAT_PENALTY`) — a preference, not a
ban, so a cell that cannot field enough kinds still fills.

This matters more the more lopsided the radar is: half the top 5000 is primarily
co-op/adventure/campaign, so without it that one genre takes two slots in most
cells simply by being numerous. Cells repeating a genre fall from 27 of 34 to 1,
and distinct genres per cell rise 3.79 → 4.63, at a cost of median pick rank
245 → 278 as cells reach past a second Terraforming Mars for the best game of a
kind they lack.

Fixing the coverage formula itself instead — an axis covered by its *best* game,
which should make the rule unnecessary — was tried and is worse on every count:
147 picks against 163, median 299, and *more* repeats. The two work at different
granularities. Coverage sees a game's whole eight-axis vector, so a second card
game that is stronger on some secondary axis still scores; the rule sees only
the primary genre, which is the question being asked.

**Duplicate suppression.** The coverage formula treats each game's coverage as an
*independent* event, which is wrong for two copies of one game — their coverage
is perfectly correlated. A clone therefore collects credit on every axis its
original only partly covers, worth `Σw − 1`, which is how Twilight Imperium 3rd
and 4th Edition once shared a cell. So each candidate's gain is scaled by

```
1 − similarity_to_nearest_pick ^ SIMILARITY_EXPONENT
```

Similarity is cosine over **centrality-weighted tags**
(`features._similarity_space`), never the genre loadings — fifteen axes leave no
room to tell a duplicate from a same-genre neighbour. Measured on the live top
5000, random pairs of games already score 0.823 against each other on the genre
axes, so Twilight Imperium 3rd/4th at 0.973 is merely the 91st percentile. In
the full tag space the bulk drops to 0.124 and that pair reaches the 99.9th.
BGG's `Game:` family links join that space and roughly double the separation.
The penalty
steers selection only — recorded gains and the coverage totals stay raw.

`--assigner mmr` (maximal marginal relevance: rank blended with distance from
picks) and `--assigner greedy` (one game per archetype) remain as
alternatives. The hand-written taxonomy in `archetypes.py` is now used *only* by
that baseline. The grid's dots and legend name each game's strongest **mined**
genre instead, so the colour beside a game is the axis its biggest radar bar
sits on — the two used to be able to disagree, with nothing keeping them in
step.

### The collection builder

`pipeline/collection.py` runs the same coverage math across the *whole*
dataset instead of one cell:

- **Anchors** are games you own or love — locked in first (even if
  suboptimal), so the greedy fill builds *around* them with complements
  instead of replacements.
- **Gaps**: any genre axis still under 50% covered is reported with the three
  best games to fill it. `--evaluate` skips the filling and just audits the
  anchors — "what does my shelf cover, what's missing?"
- **Unique contribution** (shown as a bar in the Collection tab): how much
  total coverage would vanish if a game were removed. There is deliberately
  no hard guard against later picks crowding out an anchor — instead the
  anchor's shrinking bar makes the redundancy visible, and you decide.

## Tuning it

Every tunable is reachable from a config file — nothing that changes behaviour is
hardcoded in source. `grid.example.toml` lists them all at their defaults:

```bash
python -m pipeline.build --config grid.example.toml --report
```

Anything omitted keeps its default, so a sweep file need only name what it
changes; an unknown key is an error rather than a silent no-op. The values are in
three tiers, because they belong to different people:

| Tier | Who it belongs to |
|---|---|
| `[presentation]` | Display only — changing one never moves a pick |
| `[collection]` | What a person manipulates: axes, depth, genre weights |
| `[hyper.selection]` | Fitted; runs on every recompute, no rebuild needed |
| `[hyper.discovery]` | Fitted; re-runs tag clustering, forces a rebuild |

### Uneven shelves

Cells need not hold the same number of games. The player columns are fixed ranges
over a lopsided distribution — `8+` reaches 142 games where `4` reaches 5,577,
and its median pick is worth 0.174 against 0.660 — so five slots in each mean
very different things. The rows do not have this problem: they are quantiles of
the population, so they hold 3,836–5,162 candidates apiece by construction.

Two ways to fix it, for two different problems:

```toml
[hyper.selection]
gain_floor = 0.15            # stop shelving games that merely reach a cell

[collection]
picks_per_column = { "8+" = 2 }   # or just cap it
```

Prefer `gain_floor` for scarcity. It is self-targeting — nothing in it names a
column, and at 0.20 it trims `8+` from 25 picks to 13 while leaving every other
column untouched — and it tracks the corpus instead of going stale when the
capture changes. Median pick rank improves as it rises, because it stops
shelving whatever is left rather than whatever is good. Use `picks_per_column`
and `picks_per_row` for preference: "we are four people, give me more there".

The **reasoning** stays in `pipeline/config.py`, beside each default — what was
measured, what failed, and why the value sits where it does. Read that before
changing one, and re-measure with `--report` afterwards.

- **Player columns** — `PLAYER_COLUMNS` (label + inclusive count range).
- **Number of weight rows** — `WEIGHT_ROW_COUNT`. Rows are quantiles of the
  actual population, so they stay balanced whatever you pick.
- **Feature space** — `GENRE_SPOKES` (how many radar spokes the axes group
  into), `GENRE_SCARCITY` (how much a rare genre counts for),
  `GENRE_GROWTH` (how far a genre may widen from its seed),
  `GENRE_BASE_RATE` (how broad a tag must be to earn compounds),
  `GENRE_AXIS_TARGET` (the smallest genre worth having),
  `WEIGHT_SCALE` / `PLAYTIME_SCALE` (how much the continuous stats matter vs
  genre).
- **Coverage** — `QUALITY_FLOOR` (how much the worst-rated game still covers),
  `QUALITY_EXPONENT` (how sharply a better rating beats a worse one),
  `GAIN_FLOOR` (how little a game may add and still be shelved; 0 fills every
  cell), `COLLECTION_WEIGHT` (how much the rest of the shelf pulls on a cell's
  choice), `REPLACEMENT_KEEP` (how good a swap must be to retire a
  re-recording), `COLLECTION_SIZE`, `PICKS_PER_CELL`.
- **Membership** — `RECOMMENDED_WEIGHT` (how much a "this works" vote counts
  against a "this is the best" vote), `MEMBERSHIP_FLOOR` (how far below its peak
  column a game still counts), `WEIGHT_TAPER` (how far a weight row bleeds past
  its edges), `CELL_MEMBERSHIP_FLOOR`.
- **One game per kind** — `GENRE_REPEAT_PENALTY` (what a second game of a
  genre a cell already holds is worth, relative to the first).
- **Duplicate suppression** — `SIMILARITY_EXPONENT` (falloff sharpness; higher
  is more permissive to same-genre neighbours, lower prunes harder).
- **MMR** — `MMR_LAMBDA` (1.0 = pure rank, 0.0 = pure spread).

### Swapping the selection algorithm

`assign.py` splits the problem in two, so there is one allocation path however
you select:

- **`allocate`** owns cells, rounds, exclusivity and stopping, and knows nothing
  about what the cells mean.
- **A `Scorer`** answers only "what is this game worth to this cell right now".

So a new strategy is one class with `begin` / `score` / `take` / `reset_cell` —
no second allocation loop to keep in sync. Three ship today: `CoverageScorer`
(default), `MmrScorer` (`--assigner mmr`, rank blended with distance from the
picks) and `ArchetypeScorer` (`--assigner greedy`, one game per archetype). All
three get membership, grid-wide exclusivity and the rank-seeded opening round
for free.

### Arbitrary axes

The grid's two axes aren't privileged. An `Axis` answers "how strongly does this
game belong to each of my buckets", and `buckets.build_cells(games, axes)`
crosses any list of them into cells:

```python
axes = [PlayerCountAxis(), WeightAxis(rows)]   # the grid
axes = []                                      # one cell = the whole space
```

That second line is the collection builder. It is not a parallel implementation
— `pipeline/collection.py` calls the same `allocate` with no axes and seeds the
anchors into that single cell, then does its own gap analysis on the result. A
genre or mechanic axis would be a small class beside the two existing ones.

## Note on the current data

The committed grid is built from a **live capture of BGG's top 5000**, marked
`live data` in the header. `data/games.seed.json` is the top 1000 of that same
capture, carrying every field a full capture does, so the pipeline builds
offline with `python -m pipeline.build` and no credentials. A thousand games is
a floor, not a preference: genre axes are discovered from tag co-occurrence, and
a smaller slice leaves most tags on one or two games each, so the clustering
spends its axes on pairs like `Matching · Ladder Climbing`.

The seed is a *smaller* dataset, never a *thinner* one. The pipeline has no
fallbacks for absent fields — a dataset missing `users_rated`, `families` or
`player_poll` raises rather than quietly producing a degraded grid, because a
build that reports "33 filled cells" while every game has collapsed to an
identical vector is worse than one that fails. Regenerate the seed from a live
capture rather than teaching the code to cope without it.
