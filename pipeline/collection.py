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

from . import coverage, dataset
from .config import COLLECTION_SIZE, ROOT, SEED_DATASET
from .features import build_feature_space
from .model import Game

OUTPUT = ROOT / "web" / "public" / "collection.json"
GAP_THRESHOLD = 0.5     # an axis covered below this counts as a gap
SUGGESTIONS_PER_GAP = 3


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


def build_collection(dataset_path, anchor_tokens, size, evaluate_only):
    source, generated_at, games = dataset.load_dataset(dataset_path)
    space = build_feature_space(games)
    ranks = [g.rank for g in games]

    def weights(g):
        return coverage.quality(g.rank, ranks) * space.loadings[g.id]

    anchors = find_games(anchor_tokens, games)
    anchor_ids = {g.id for g in anchors}
    anchor_weights = [weights(g) for g in anchors]
    n_axes = len(space.dimension_names)

    # Fill around the anchors (unless we're only evaluating them).
    picks = []
    if not evaluate_only:
        candidates = [(g, weights(g)) for g in games if g.id not in anchor_ids]
        picks = coverage.greedy_fill(
            candidates, seed=anchor_weights, max_picks=max(size - len(anchors), 0),
        )

    members = anchors + [p.game for p in picks]
    member_weights = [weights(g) for g in members]
    gains = [None] * len(anchors) + [p.gain for p in picks]

    anchor_coverage = coverage.axis_coverage(anchor_weights, n_axes)
    full_coverage = coverage.axis_coverage(member_weights, n_axes)

    # Gaps: axes still thin after everything, with the best remaining fills.
    uncovered = 1.0 - full_coverage
    member_ids = {g.id for g in members}
    gaps = []
    for d in range(n_axes):
        if full_coverage[d] >= GAP_THRESHOLD:
            continue
        fills = sorted(
            ((float(weights(g)[d] * uncovered[d]), g) for g in games if g.id not in member_ids),
            key=lambda t: -t[0],
        )[:SUGGESTIONS_PER_GAP]
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
    parser.add_argument("--size", type=int, default=COLLECTION_SIZE,
                        help="target collection size including anchors")
    parser.add_argument("--evaluate", action="store_true",
                        help="only report what the anchors cover; don't fill")
    args = parser.parse_args()
    tokens = [t for t in args.anchors.split(",") if t.strip()]
    build_collection(args.dataset, tokens, args.size, args.evaluate)


if __name__ == "__main__":
    main()
