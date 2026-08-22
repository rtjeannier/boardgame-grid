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
from pathlib import Path

import numpy as np

from . import buckets, coverage, dataset
from .assign import ArchetypeScorer, CoverageScorer, MmrScorer, allocate
from .config import OUTPUT_JSON, SEED_DATASET
from .contract import PLACES, QuantisedSpace, build_contract, quantise_games
from .contract import write as write_contract
from . import depth
from .params import DEFAULTS, Params
from .features import build_feature_space, genre_overlap
from .report import build_report, format_report


def build(dataset_path, assigner_name, want_report=False, output=None,
          params: Params = DEFAULTS, contract_path=None):
    source, generated_at, games = dataset.load_dataset(dataset_path)
    space = build_feature_space(games, params)
    sel, coll, pres = params.selection, params.collection, params.presentation
    weight_rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)

    # The grid is just this stratification of the game space. Swap the axes and
    # the same allocator fills whatever cells come out; pass none at all and it
    # builds a collection, which is what pipeline/collection.py does.
    ratings = {g.id: g.rating for g in games}   # population-wide, never per cell
    axes = [buckets.PlayerCountAxis(coll.columns(), sel),
            buckets.WeightAxis(weight_rows, sel)]
    cells, memberships = buckets.build_cells(games, axes, sel)
    genre = coverage.genre_weights(space.loadings, ratings, sel)

    scorer = {
        "coverage": lambda: CoverageScorer(space.loadings, space.similarity, ratings,
                                          space.spoke_of, sel,
                                          coll.axis_room(space.dimension_names,
                                                         space.spoke_of)),
        "mmr": lambda: MmrScorer(space.vectors, params.baseline),
        "greedy": lambda: ArchetypeScorer(),
    }[assigner_name]()
    # Depth is read from each axis's own curve when `auto_depth` is on, and is
    # the reader's number when it is not. Both are ceilings, and a cell takes
    # the smaller of its column's and its row's — the same rule either way.
    if coll.auto_depth:
        capacity = depth.grid_depths(games, space, ratings, sel, coll, weight_rows,
                                     axis_room=coll.axis_room(space.dimension_names,
                                                              space.spoke_of))["capacity"]
    else:
        capacity = coll.capacity(cells)
    results = allocate(cells, memberships, scorer, capacity,
                       alternates_limit=pres.alternates_per_cell, sel=sel)

    def primary_genre(g):
        """The mined genre this game is most of — its colour on the grid.

        Straight from the feature space, so the dot beside a game names the same
        axis its biggest radar bar sits on. The old hand-written archetype
        taxonomy said 'Set Collection' where the radar said something else, and
        nothing kept the two in step.
        """
        loading = space.spokes[g.id]
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
            # Mirrors CoverageScorer exactly, membership included, then summed
            # into radar spokes, so the chart aggregates the very vector
            # selection was scored against rather than recomputing anything.
            fine = memberships[(key, g.id)] * genre[g.id]
            return np.bincount(space.spoke_of, weights=fine,
                               minlength=len(space.dimension_names))

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
            "playerColumns": [c["label"] for c in coll.columns()],
            "weightRows": weight_rows,
            "genreDimensions": space.dimension_names,
        },
        "cells": [
            cell_json(key, result)
            for key, result in sorted(results.items(), key=lambda kv: (kv[0][0], int(kv[0][1])))
        ],
    }

    output = Path(output) if output else OUTPUT_JSON
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {output.name} — {len(games)} games, "
          f"{len(payload['cells'])} filled cells ({source} data, {assigner_name} assigner)")

    # Genres are only useful if they ask different questions, so say how far
    # apart they came out. A worst pair creeping up means axis discovery has
    # started manufacturing near-duplicates (see features.genre_overlap).
    overlap = genre_overlap(space, params)
    worst, a, b = overlap[0]
    print(f"  {len(space.dimension_names)} genres, overlap "
          f"mean {sum(v for v, _, _ in overlap) / len(overlap):.3f}, worst {worst:.3f} "
          f"({space.dimension_names[a].split(pres.genre_name_separator)[0]} / "
          f"{space.dimension_names[b].split(pres.genre_name_separator)[0]})")

    if contract_path is not None:
        # `defaultPicks` is recomputed on the quantised space rather than reusing
        # the grid above. The contract carries rounded numbers, so a precomputed
        # grid derived from exact ones is a grid the browser cannot reproduce —
        # it would paint on load and then visibly change on first interaction,
        # for no reason a reader could see.
        qgames = quantise_games(games)
        qspace = QuantisedSpace(space)
        qcells, qmemb = buckets.build_cells(
            qgames, [buckets.PlayerCountAxis(coll.columns(), sel, places=PLACES),
                     buckets.WeightAxis(
                         buckets.build_weight_rows([g.weight for g in qgames],
                                                   coll.weight_rows), sel)], sel)
        qresults = allocate(
            qcells, qmemb,
            CoverageScorer(qspace.loadings, qspace.similarity,
                           {g.id: g.rating for g in qgames}, qspace.spoke_of, sel,
                           coll.axis_room(space.dimension_names, space.spoke_of)),
            coll.capacity(qcells), alternates_limit=pres.alternates_per_cell, sel=sel)
        size = write_contract(
            build_contract(qgames, qspace, qresults, source, generated_at, params),
            Path(contract_path) if contract_path else None)
        print(f"  contract {size / 1024:.0f} KB raw")

    if want_report:
        print()
        print(format_report(build_report(space, games, results,
                                         capacity, source, params)))

    return payload


def main():
    parser = argparse.ArgumentParser(description="Build the board-game grid JSON from a dataset.")
    parser.add_argument("--dataset", default=str(SEED_DATASET),
                        help="dataset file to build from (default: the seed proxy)")
    parser.add_argument("--assigner", choices=["coverage", "mmr", "greedy"], default="coverage",
                        help="per-cell selection strategy (default: probabilistic coverage)")
    parser.add_argument("--config", default=None,
                        help="TOML file layered over the defaults. Anything "
                             "omitted keeps its default value.")
    parser.add_argument("--contract", nargs="?", const="", default=None,
                        help="also emit the model/UI contract "
                             "(default: web/public/grid.contract.json)")
    parser.add_argument("--report", action="store_true",
                        help="print the four numbers this repo judges changes on")
    parser.add_argument("--output", default=None,
                        help="where to write the grid (default: web/public/grid.json). "
                             "Point it elsewhere to measure without touching the "
                             "committed artifact.")
    args = parser.parse_args()
    build(args.dataset, args.assigner, want_report=args.report,
          output=args.output, params=Params.load(args.config),
          contract_path=args.contract)


if __name__ == "__main__":
    main()
