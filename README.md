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
pipeline/            Python: BGG data -> grid.json
  config.py          the two axes + tunables (edit me first)
  archetypes.py      the "type" taxonomy (mechanic/category -> archetype)
  buckets.py         player-count columns + quantile weight rows
  assign.py          swappable per-cell de-duplication (GreedyAssigner)
  client.py          live BGG XML API2 client (cached)
  seed.py            offline curated dataset for a no-network first pass
  build.py           orchestrator -> web/public/grid.json
web/                 Vite + React explorer, builds into ../docs
docs/                the built site GitHub Pages serves
```

Data flows one way: `Game` objects (from `seed.py` **or** `client.py`) →
bucketed onto the axes → assigned one-per-archetype per cell → serialised to
`grid.json`. The frontend just renders that JSON, so nothing in the UI depends
on where the data came from.

## Run it

**Build the grid (offline seed data — no dependencies):**

```bash
python -m pipeline.build
```

**Build from live BoardGameGeek data:**

```bash
pip install -r requirements.txt
python -m pipeline.build --live --limit 500
```

This reads BGG's ranked listing, hydrates each game via the XML API2 (weight,
the community best-player-count poll, mechanics, categories), caches every
response under `data/cache/`, and writes `web/public/grid.json`.

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

The committed grid is built from `pipeline/seed.py` — a hand-entered slice of
well-known top games with **approximate** weights and player counts, marked
`seed data` in the header. Run `python -m pipeline.build --live` on a networked
machine to replace it with current BGG numbers; the UI is unchanged.
