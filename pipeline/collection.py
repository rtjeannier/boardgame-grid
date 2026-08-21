"""Build or evaluate a whole collection with anchored games and gap analysis.

    python -m pipeline.collection --anchors "CATAN" --size 15
    python -m pipeline.collection --anchors "CATAN, Codenames" --evaluate
    python -m pipeline.collection                       # no anchors, pure greedy

Anchors are games you own or love — they're locked into the collection first
(even if suboptimal), and the greedy coverage loop fills the remaining slots
with complements rather than replacements. `--evaluate` skips the filling and
just reports what the anchors cover and where the gaps are.

Writes web/public/collection.json for the site's Collection tab and prints a
readable summary. Works against the whole dataset (unlike the grid, which
selects within player-count × weight cells).
"""

import argparse
import json
from collections import defaultdict

import numpy as np

from . import buckets, coverage, dataset
from .assign import CoverageScorer, allocate
from .config import ROOT, SEED_DATASET
from .params import DEFAULTS, Params
from .features import build_feature_space
from .model import Game

OUTPUT = ROOT / "web" / "public" / "collection.json"


def find_games(tokens: list[str], games: list[Game]) -> list[Game]:
    """Resolve anchor tokens (case-insensitive name or BGG id) to games."""
    found = []
    for token in tokens:
        token = token.strip()
        match = next(
            (g for g in games
             if str(g.id) == token or g.name.lower() == token.lower()),
            None,
        ) or next(
            (g for g in games if token.lower() in g.name.lower()), None
        )
        if match is None:
            raise SystemExit(f"No game in the dataset matches '{token}'")
        found.append(match)
    return found


def build_collection(dataset_path, anchor_tokens, size, evaluate_only,
                     params: Params = DEFAULTS):
    source, generated_at, games = dataset.load_dataset(dataset_path)
    space = build_feature_space(games, params)
    sel, pres = params.selection, params.presentation
    ratings = {g.id: g.rating for g in games}
    genre = coverage.genre_weights(space.loadings, ratings, sel)

    spoke_of = np.asarray(space.spoke_of)
    n_axes = len(space.dimension_names)

    def weights(g):
        """Quality-scaled loadings, summed into radar spokes.

        Selection below still runs on the full axis set; this is only what gets
        reported, so the coverage a reader sees aggregates the vectors the
        picker scored rather than being computed a second way.
        """
        return np.bincount(spoke_of, weights=genre[g.id], minlength=n_axes)

    anchors = find_games(anchor_tokens, games)
    anchor_ids = {g.id for g in anchors}
    anchor_weights = [weights(g) for g in anchors]

    # The collection is the grid with no axes: one cell holding the whole game
    # space. Same allocator, same coverage maths, same duplicate suppression —
    # anchors are simply seeded into that cell before the rounds begin, so they
    # occupy slots and repel near-duplicates (anchor Wingspan and Wyrmspan stops
    # being a candidate rather than filling a slot beside it).
    cells, memberships = buckets.build_cells(games, axes=[], sel=sel)
    scorer = CoverageScorer(space.loadings, space.similarity, ratings,
                            space.spoke_of, sel)
    picks = []
    if not evaluate_only:
        results = allocate(cells, memberships, scorer, capacity=size,
                           seeded={(): anchors}, sel=sel)
        picks = [a for a in results[()].assignments if a.game.id not in anchor_ids]

    members = anchors + [a.game for a in picks]
    member_weights = [weights(g) for g in members]
    gains = [None] * len(anchors) + [a.gain for a in picks]

    anchor_coverage = coverage.axis_coverage(anchor_weights, n_axes)
    full_coverage = coverage.axis_coverage(member_weights, n_axes)

    # Gaps: axes still thin after everything, with the best remaining fills.
    uncovered = 1.0 - full_coverage
    member_ids = {g.id for g in members}
    gaps = []
    for d in range(n_axes):
        if full_coverage[d] >= pres.gap_threshold:
            continue
        fills = sorted(
            ((float(weights(g)[d] * uncovered[d]), g) for g in games if g.id not in member_ids),
            key=lambda t: -t[0],
        )[:pres.suggestions_per_gap]
        gaps.append({
            "dimension": space.dimension_names[d],
            "coverage": round(float(full_coverage[d]), 3),
            "suggestions": [{"name": g.name, "id": g.id, "rank": g.rank} for _, g in fills],
        })

    payload = {
        "meta": {
            "source": source,
            "generatedAt": generated_at,
            "size": len(members),
            "anchors": [g.name for g in anchors],
            "dimensions": space.dimension_names,
        },
        "anchorCoverage": [round(float(c), 3) for c in anchor_coverage],
        "fullCoverage": [round(float(c), 3) for c in full_coverage],
        "games": [
            {
                **g.to_dict(),
                "anchored": g.id in anchor_ids,
                "gain": gains[i],
                "uniqueContribution": coverage.unique_contribution(i, member_weights),
                "genres": [{"name": n, "value": v} for n, v in space.top_genres[g.id]],
                # Quality-scaled genre-loading vector (one per dimension): the
                # game's own "shadow" on the radar, used to highlight its
                # contribution when clicked in the Collection list.
                "coverage": [round(float(w), 3) for w in member_weights[i]],
            }
            for i, g in enumerate(members)
        ],
        "gaps": sorted(gaps, key=lambda g: g["coverage"]),
    }
    OUTPUT.write_text(json.dumps(payload, indent=2))

    total = full_coverage.sum()
    print(f"Wrote {OUTPUT.name} — {len(members)} games "
          f"({len(anchors)} anchored), {total:.1f}/{n_axes} radar covered")
    for g in payload["games"]:
        tag = "anchor" if g["anchored"] else f"+{g['gain']:.2f}"
        print(f"  {tag:>7}  #{g['rank']:>3} {g['name']:<42} unique {g['uniqueContribution']:.2f}")
    for gap in payload["gaps"]:
        names = ", ".join(s["name"] for s in gap["suggestions"])
        print(f"  GAP {gap['coverage']:.2f}  {gap['dimension']}  → try: {names}")


def main():
    parser = argparse.ArgumentParser(description="Build or evaluate a collection with anchors.")
    parser.add_argument("--dataset", default=str(SEED_DATASET))
    parser.add_argument("--anchors", default="",
                        help="comma-separated game names or BGG ids to lock in")
    parser.add_argument("--size", type=int, default=None,
                        help="target collection size including anchors")
    parser.add_argument("--evaluate", action="store_true",
                        help="only report what the anchors cover; don't fill")
    parser.add_argument("--config", default=None,
                        help="TOML file layered over the defaults")
    args = parser.parse_args()
    params = Params.load(args.config)
    tokens = [t for t in args.anchors.split(",") if t.strip()]
    size = args.size if args.size is not None else params.collection.collection_size
    build_collection(args.dataset, tokens, size, args.evaluate, params)


if __name__ == "__main__":
    main()
