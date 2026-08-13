"""Build the grid from a dataset and write it to JSON for the frontend.

    python -m pipeline.build                              # seed proxy dataset
    python -m pipeline.build --dataset data/games.json    # live capture
    python -m pipeline.build --assigner mmr               # distance-based selection
    python -m pipeline.build --assigner greedy            # taxonomy baseline

Flow: load a dataset -> embed every game in the continuous feature space ->
mine weight rows from the population -> drop each game into its one home cell
(its weight row × its peak-player-count column) -> ask the assigner for a
diverse subset per cell -> serialise. The build never fetches anything; it
only ever consumes a dataset file.
"""

import argparse
import json
from collections import defaultdict

from . import buckets, coverage, dataset
from .archetypes import ARCHETYPES
from .assign import CoverageAssigner, GreedyAssigner, MmrAssigner, assign_grid
from .config import ALTERNATES_PER_CELL, OUTPUT_JSON, PLAYER_COLUMNS, SEED_DATASET, WEIGHT_ROW_COUNT
from .features import build_feature_space


def build(dataset_path, assigner_name):
    source, generated_at, games = dataset.load_dataset(dataset_path)
    space = build_feature_space(games)
    weight_rows = buckets.build_weight_rows([g.weight for g in games], WEIGHT_ROW_COUNT)

    # Drop each game into its single home cell: one weight row (its weight) and
    # one player column (its peak player count).
    cells = defaultdict(list)
    for game in games:
        col = buckets.player_column_for(game)
        if not col:
            continue  # no player-count signal — nothing to place
        row = buckets.weight_row_index(game.weight, weight_rows)
        cells[(col, row)].append(game)

    assigner = {
        "coverage": lambda: CoverageAssigner(space.loadings),
        "mmr": lambda: MmrAssigner(space.vectors),
        "greedy": lambda: GreedyAssigner(),
    }[assigner_name]()
    results = assign_grid(cells, assigner, ALTERNATES_PER_CELL)

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
                  "genres": [{"name": n, "value": v} for n, v in space.top_genres[g.id]]}
        if weight is not None:
            record["coverage"] = [round(float(w), 3) for w in weight]
        return record

    def cell_json(col, row, result):
        """One cell: its picks and alternates, each carrying a coverage vector.

        Quality is percentile *within this cell's* candidate pool, so a game's
        radar contribution matches the coverage the assigner saw when filling
        the cell (see pipeline/coverage.quality)."""
        pool = cells[(col, row)]
        ranks = [g.rank for g in pool]

        def weight(g):
            return coverage.quality(g.rank, ranks) * space.loadings[g.id]

        return {
            "column": col,
            "row": row,
            "candidateCount": len(pool),
            "assignments": [
                {"archetype": a.archetype, "game": game_json(a.game, weight(a.game)), "gain": a.gain}
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
            "archetypes": [a.label for a in ARCHETYPES],
            "genreDimensions": space.dimension_names,
        },
        "cells": [
            cell_json(col, row, result)
            for (col, row), result in sorted(results.items())
        ],
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUTPUT_JSON.name} — {len(games)} games, "
          f"{len(payload['cells'])} filled cells ({source} data, {assigner_name} assigner)")


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
