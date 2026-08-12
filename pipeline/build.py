"""Build the grid from a dataset and write it to JSON for the frontend.

    python -m pipeline.build                              # seed proxy dataset
    python -m pipeline.build --dataset data/games.json    # live capture

Flow: load a dataset -> mine weight rows from the population -> drop each game
into its one home cell (its weight row × its peak-player-count column) -> ask
the assigner to pick one game per archetype per cell -> serialise. The build
never fetches anything; it only ever consumes a dataset file.
"""

import argparse
import json
from collections import defaultdict

from . import buckets, dataset
from .archetypes import ARCHETYPES
from .assign import GreedyAssigner, assign_grid
from .config import ALTERNATES_PER_CELL, OUTPUT_JSON, PLAYER_COLUMNS, SEED_DATASET, WEIGHT_ROW_COUNT


def build(dataset_path):
    source, generated_at, games = dataset.load_dataset(dataset_path)
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

    results = assign_grid(cells, GreedyAssigner(), ALTERNATES_PER_CELL)

    payload = {
        "meta": {
            "source": source,
            "generatedAt": generated_at,
            "gameCount": len(games),
            "playerColumns": [c["label"] for c in PLAYER_COLUMNS],
            "weightRows": weight_rows,
            "archetypes": [a.label for a in ARCHETYPES],
        },
        "cells": [
            {
                "column": col,
                "row": row,
                "candidateCount": len(cells[(col, row)]),
                "assignments": [
                    {"archetype": a.archetype, "game": a.game.to_dict()}
                    for a in result.assignments
                ],
                "alternates": [g.to_dict() for g in result.alternates],
            }
            for (col, row), result in sorted(results.items())
        ],
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUTPUT_JSON.name} — {len(games)} games, "
          f"{len(payload['cells'])} filled cells ({source} data)")


def main():
    parser = argparse.ArgumentParser(description="Build the board-game grid JSON from a dataset.")
    parser.add_argument("--dataset", default=str(SEED_DATASET),
                        help="dataset file to build from (default: the seed proxy)")
    args = parser.parse_args()
    build(args.dataset)


if __name__ == "__main__":
    main()
