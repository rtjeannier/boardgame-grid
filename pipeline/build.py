"""Build the grid and write it to JSON for the frontend.

Flow:  load games -> mine weight rows from the population -> drop each game
into every (player column, weight row) cell it qualifies for -> ask the
assigner to pick one game per archetype per cell -> serialise.

    python -m pipeline.build                 # offline seed data
    python -m pipeline.build --live          # fetch live from BGG
    python -m pipeline.build --live --limit 300
"""

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone

from . import buckets
from .archetypes import ARCHETYPES
from .assign import GreedyAssigner, assign_grid
from .config import ALTERNATES_PER_CELL, OUTPUT_JSON, PLAYER_COLUMNS, WEIGHT_ROW_COUNT


def load_games(live: bool, limit: int):
    if live:
        from .client import BggClient
        return BggClient().top_games(limit)
    from .seed import seed_games
    return seed_games()


def build(live: bool, limit: int):
    games = load_games(live, limit)
    weight_rows = buckets.build_weight_rows([g.weight for g in games], WEIGHT_ROW_COUNT)

    # Fan every game out into the cells it belongs to. A game spans several
    # columns (its best player counts) but exactly one weight row.
    cells = defaultdict(list)
    for game in games:
        row = buckets.weight_row_index(game.weight, weight_rows)
        for col in buckets.player_columns_for(game):
            cells[(col, row)].append(game)

    results = assign_grid(cells, GreedyAssigner(), ALTERNATES_PER_CELL)

    payload = {
        "meta": {
            "source": "live" if live else "seed",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
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
    print(f"Wrote {OUTPUT_JSON.relative_to(OUTPUT_JSON.parents[2])} "
          f"— {len(games)} games, {len(payload['cells'])} filled cells "
          f"({payload['meta']['source']} data)")


def main():
    parser = argparse.ArgumentParser(description="Build the board-game grid JSON.")
    parser.add_argument("--live", action="store_true", help="fetch live data from BGG")
    parser.add_argument("--limit", type=int, default=500, help="how many top games to fetch (live only)")
    args = parser.parse_args()
    build(args.live, args.limit)


if __name__ == "__main__":
    main()
