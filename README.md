# Board Game Grid

Curate a board-game collection as a 2-D grid:

- **Columns — player count:** `1, 2, 3, 4, 5, 6-8, 8+`
- **Rows — complexity/weight:** data-mined quantile buckets, so each row holds a
  comparable number of games instead of a near-empty "heavy" row.
- **Inside each cell:** a subset chosen for *coverage* of a continuous game
  space — no two near-identical games, however well-ranked both are.

Games live in an n-dimensional feature space: latent **genre dimensions**
factored out of BGG's mechanic/category data (a game isn't "a deck builder",
it's 0.7 deck-building / 0.4 worker-placement), plus weight and playtime.
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
  features.py        the continuous feature space (IDF -> NMF genres -> vectors)
  coverage.py        the radar-chart coverage maths (no selection)
  assign.py          one allocator over any axes + swappable Scorers
  collection.py      the same allocator with no axes: anchors, gap analysis
  archetypes.py      display-label taxonomy (mechanic/category -> archetype)
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

1. Game × signal incidence matrix from BGG mechanic/category names,
   IDF-weighted so ubiquitous signals (Hand Management) count less than
   distinctive ones (Hidden Roles, Flicking). The weighting is *sublinear*:
   BGG tags are polysemous — "Action Queue" means programming combat cards in
   Gloomhaven and column action selection in Wingspan — and an undamped IDF
   let one rare tag decide a game's whole genre.
2. NMF factors it into ~10 latent genre dimensions with non-negative,
   human-readable loadings; each dimension is named by its top signals
   (on the seed data they come out as recognisable genres — social deduction,
   dexterity, tile-laying, party/word — with no hand labelling).
   Note that the dimensions follow the *corpus*, not some fixed genre map: NMF
   spends them on whatever tag co-occurrence is most common, so the curated seed
   set yields an `Action / Dexterity` axis while the rank-ordered live top 1000
   does not — dexterity is only 9 games there, too few to form a factor. Genres
   that never co-occur as a block (Push Your Luck, Trick-taking) get no axis at
   any component count.
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

- **Columns** come from the suggested-players poll, scored **peak-relative**:
  the game's strongest column is 1.0 and the others measure against it. A game
  the community likes equally at 3, 4, 5 and 6 therefore scores 1.0 in all four
  — versatility is not punished. (Scoring by share-of-total would give it 0.25
  apiece and rank it below a mediocre game playable only at 4.)
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

`quality` comes from BGG's **Bayesian average**, normalised across the whole
population — not from rank position, and not from a percentile within the cell.
Both of those flatten the top: in an 857-game cell spanning ranks 3 to 4991,
Orléans (#35) and Rajas of the Ganges (#170) scored 0.996 and 0.975, so a
135-place gap was worth 0.02, and a game's quality moved with whichever other
games happened to share its cell. `QUALITY_EXPONENT` then sets how sharply a
better rating wins, because the rating band itself is narrow — 8.39 at #1 down
to 5.79 at #5000.

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

The **opening round bids by rank**, later rounds by coverage gain. Against an
empty radar a game's gain is just the sum of its loadings, so without this the
widest-spread game wins the first slot however mediocre it is; the opening pick
should answer "what is the best game here", and coverage takes over once there
is something on the chart to complement. Picking stops when nothing left would
add much (`GAIN_FLOOR`), so rich cells naturally get more picks than thin ones.

**Duplicate suppression.** That formula treats each game's coverage as an
*independent* event, which is wrong for two copies of one game — their coverage
is perfectly correlated. A clone therefore collects credit on every axis its
original only partly covers, worth `Σw − 1`, which is how Twilight Imperium 3rd
and 4th Edition once shared a cell. So each candidate's gain is scaled by

```
1 − similarity_to_nearest_pick ^ SIMILARITY_EXPONENT
```

Similarity is cosine in the **full tag space** (`features._similarity_space`),
never the 10-dim NMF loadings — the bottleneck discards exactly the detail that
separates a duplicate from a same-genre neighbour. Measured on the live top 1000,
Decrypto/Monikers (unrelated) score 0.955 in NMF space against Twilight Imperium
3rd/4th at 0.997 — indistinguishable; in full space those become 0.230 and 0.817.
BGG's `Game:` family links join that space and roughly double the separation.
The penalty
steers selection only — recorded gains and the coverage totals stay raw.

`--assigner mmr` (maximal marginal relevance: rank blended with distance from
picks) and `--assigner greedy` (one game per archetype) remain as
alternatives. The archetype taxonomy in `archetypes.py` is display-only — it
colors the dots and legend, but never drives selection.

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

Everything lives in `pipeline/config.py`:

- **Player columns** — `PLAYER_COLUMNS` (label + inclusive count range).
- **Number of weight rows** — `WEIGHT_ROW_COUNT`. Rows are quantiles of the
  actual population, so they stay balanced whatever you pick.
- **Feature space** — `NMF_COMPONENTS` (genre dimensions), `WEIGHT_SCALE` /
  `PLAYTIME_SCALE` (how much the continuous stats matter vs genre).
- **Coverage** — `QUALITY_FLOOR` (how much the worst-rated game still covers),
  `QUALITY_EXPONENT` (how sharply a better rating beats a worse one),
  `GAIN_FLOOR` (when to stop picking), `COLLECTION_SIZE`, `PICKS_PER_CELL`.
- **Membership** — `MEMBERSHIP_FLOOR` (how far below its peak column a game
  still counts), `WEIGHT_TAPER` (how far a weight row bleeds past its edges),
  `CELL_MEMBERSHIP_FLOOR`.
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
`live data` in the header. `data/games.seed.json` is a 145-game slice of that
same capture, carrying every field a full capture does, so the pipeline builds
offline with `python -m pipeline.build` and no credentials.

The seed is a *smaller* dataset, never a *thinner* one. The pipeline has no
fallbacks for absent fields — a dataset missing `users_rated`, `families` or
`best_votes` raises rather than quietly producing a degraded grid, because a
build that reports "33 filled cells" while every game has collapsed to an
identical vector is worse than one that fails. Regenerate the seed from a live
capture rather than teaching the code to cope without it.
