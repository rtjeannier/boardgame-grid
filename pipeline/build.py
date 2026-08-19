"""Build the grid from a dataset and write it to JSON for the frontend.

    python -m pipeline.build                              # seed proxy dataset
    python -m pipeline.build --dataset data/games.json    # live capture
    python -m pipeline.build --assigner mmr               # distance-based selection
    python -m pipeline.build --assigner greedy            # taxonomy baseline

Flow: load a dataset -> embed every game in the continuous feature space ->
mine weight rows from the population -> cross the two axes into cells, placing
each game in every cell it reaches *by degree* -> allocate games across the
whole grid so each is used once -> serialise. The build never fetches anything;
it only ever consumes a dataset file.

The grid is one stratification among many: `pipeline/assign.allocate` has no
idea these axes mean players and weight, and `pipeline/collection.py` drives it
with no axes at all to search the whole space.
"""

import argparse
import json

from . import buckets, coverage, dataset
from .assign import ArchetypeScorer, CoverageScorer, MmrScorer, allocate
from .config import (
    ALTERNATES_PER_CELL,
    GENRE_NAME_SEPARATOR,
    OUTPUT_JSON,
    PICKS_PER_CELL,
    PLAYER_COLUMNS,
    SEED_DATASET,
    WEIGHT_ROW_COUNT,
)
from .features import build_feature_space, genre_overlap


def build(dataset_path, assigner_name):
    source, generated_at, games = dataset.load_dataset(dataset_path)
    space = build_feature_space(games)
    weight_rows = buckets.build_weight_rows([g.weight for g in games], WEIGHT_ROW_COUNT)

    # The grid is just this stratification of the game space. Swap the axes and
    # the same allocator fills whatever cells come out; pass none at all and it
    # builds a collection, which is what pipeline/collection.py does.
    ratings = {g.id: g.rating for g in games}   # population-wide, never per cell
    axes = [buckets.PlayerCountAxis(), buckets.WeightAxis(weight_rows)]
    cells, memberships = buckets.build_cells(games, axes)
    genre = coverage.genre_weights(space.loadings, ratings)

    scorer = {
        "coverage": lambda: CoverageScorer(space.loadings, space.similarity, ratings),
        "mmr": lambda: MmrScorer(space.vectors),
        "greedy": lambda: ArchetypeScorer(),
    }[assigner_name]()
    results = allocate(cells, memberships, scorer, PICKS_PER_CELL,
                       alternates_limit=ALTERNATES_PER_CELL)

    def primary_genre(g):
        """The mined genre this game is most of — its colour on the grid.

        Straight from the feature space, so the dot beside a game names the same
        axis its biggest radar bar sits on. The old hand-written archetype
        taxonomy said 'Set Collection' where the radar said something else, and
        nothing kept the two in step.
        """
        loading = space.loadings[g.id]
        if not loading.any():
            return None            # no signals at all; nothing to claim
        return space.dimension_names[int(loading.argmax())]

    def game_json(g, weight=None):
        """Game record + its place in the feature space, for the frontend.

        `weight` is the game's quality-scaled genre-loading vector within its
        cell (quality × loading, one entry per genre dimension) — the same
        per-axis "probability" the coverage model uses. Serialised as
        `coverage` so the frontend radar can draw one cell's picks and
        highlight a single game's contribution to it.
        """
        x, y = space.projection[g.id]
        record = {**g.to_dict(), "x": x, "y": y,
                  "genre": primary_genre(g),
                  "genres": [{"name": n, "value": v} for n, v in space.top_genres[g.id]]}
        if weight is not None:
            record["coverage"] = [round(float(w), 3) for w in weight]
        return record

    def cell_json(key, result):
        """One cell: its picks and alternates, each carrying a coverage vector.

        Quality is percentile *within this cell's* candidate pool, so a game's
        radar contribution matches the coverage the assigner saw when filling
        the cell (see pipeline/coverage.genre_quality)."""
        col, row = key            # axis labels, in the order build_cells crossed them
        pool = cells[key]

        def weight(g):
            # Mirrors CoverageScorer exactly, membership included, so the radar
            # the frontend draws is the one selection was scored against.
            return memberships[(key, g.id)] * genre[g.id]

        return {
            "column": col,
            "row": int(row),      # WeightAxis labels its rows by index
            "candidateCount": len(pool),
            "assignments": [
                {"game": game_json(a.game, weight(a.game)), "gain": a.gain}
                for a in result.assignments
            ],
            "alternates": [game_json(g, weight(g)) for g in result.alternates],
        }

    payload = {
        "meta": {
            "source": source,
            "generatedAt": generated_at,
            "gameCount": len(games),
            "assigner": assigner_name,
            "playerColumns": [c["label"] for c in PLAYER_COLUMNS],
            "weightRows": weight_rows,
            "genreDimensions": space.dimension_names,
        },
        "cells": [
            cell_json(key, result)
            for key, result in sorted(results.items(), key=lambda kv: (kv[0][0], int(kv[0][1])))
        ],
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUTPUT_JSON.name} — {len(games)} games, "
          f"{len(payload['cells'])} filled cells ({source} data, {assigner_name} assigner)")

    # Genres are only useful if they ask different questions, so say how far
    # apart they came out. A worst pair creeping up means axis discovery has
    # started manufacturing near-duplicates (see features.genre_overlap).
    overlap = genre_overlap(space)
    worst, a, b = overlap[0]
    print(f"  {len(space.dimension_names)} genres, overlap "
          f"mean {sum(v for v, _, _ in overlap) / len(overlap):.3f}, worst {worst:.3f} "
          f"({space.dimension_names[a].split(GENRE_NAME_SEPARATOR)[0]} / "
          f"{space.dimension_names[b].split(GENRE_NAME_SEPARATOR)[0]})")


def main():
    parser = argparse.ArgumentParser(description="Build the board-game grid JSON from a dataset.")
    parser.add_argument("--dataset", default=str(SEED_DATASET),
                        help="dataset file to build from (default: the seed proxy)")
    parser.add_argument("--assigner", choices=["coverage", "mmr", "greedy"], default="coverage",
                        help="per-cell selection strategy (default: probabilistic coverage)")
    args = parser.parse_args()
    build(args.dataset, args.assigner)


if __name__ == "__main__":
    main()
