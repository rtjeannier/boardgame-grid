# Board Game Grid

Curate a board-game collection as a 2-D grid:

- **Columns — player count:** `1, 2, 3, 4, 5, 6-8, 8+`
- **Rows — complexity/weight:** data-mined quantile buckets, so each row holds a
  comparable number of games instead of a near-empty "heavy" row.
- **Inside each cell:** the best-ranked game of each *archetype* (worker
  placement, social deduction, engine builder…), so no two games in a cell play
  the same way.

The output is an interactive static site you can host on GitHub Pages.

![grid preview](docs/preview.png)

## How it fits together

```
pipeline/            Python — two independent steps joined by a dataset file
  fetch.py           live BGG capture  -> data/games.json      (touches network)
  build.py           dataset           -> web/public/grid.json (no network)
  dataset.py         the dataset file format (load/save)
  client.py          live BGG XML API2 client (cached), used by fetch
  config.py          the two axes + tunables (edit me first)
  archetypes.py      the "type" taxonomy (mechanic/category -> archetype)
  buckets.py         player-count columns + quantile weight rows
  assign.py          swappable per-cell de-duplication (GreedyAssigner)
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

**Build the grid from the committed seed proxy (no network, no dependencies):**

```bash
python -m pipeline.build            # reads data/games.seed.json -> grid.json
```

**Refresh from live BoardGameGeek data (two steps):**

```bash
pip install -r requirements.txt
python -m pipeline.fetch --limit 500            # -> data/games.json
python -m pipeline.build --dataset data/games.json
```

`fetch` reads BGG's ranked listing, hydrates each game via the XML API2
(weight, the community best-player-count poll, mechanics, categories) and
caches every response under `data/cache/`. `build` is unchanged either way.

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

## Tuning it

Everything you'd want to change lives in `pipeline/config.py` and
`pipeline/archetypes.py`:

- **Player columns** — edit `PLAYER_COLUMNS` (label + inclusive count range).
- **Number of weight rows** — `WEIGHT_ROW_COUNT`. Rows are quantiles of the
  actual population, so they stay balanced whatever you pick.
- **Archetypes** — add an `Archetype(label, specificity, signals)` in
  `archetypes.py`. `signals` are BGG mechanic/category names; `specificity`
  decides which type a multi-mechanic game is counted as.

### Swapping the de-duplication algorithm

`assign.py` defines a tiny `Assigner` protocol and a default `GreedyAssigner`
(walk games best-rank-first, each claims its most-defining still-free
archetype). Every cell is assigned independently of the others, so a new
strategy — weighted matching, an ILP, something ML-ranked — only has to
implement `assign(games, alternates_limit) -> CellResult`, and the grid stays
trivially parallelisable across cells.

## Note on the current data

The committed grid is built from `data/games.seed.json` — a hand-entered slice
of well-known top games with **approximate** weights and player counts, marked
`seed data` in the header. On a networked machine, run `python -m pipeline.fetch`
then `python -m pipeline.build --dataset data/games.json` to replace it with
current BGG numbers; the UI is unchanged.
