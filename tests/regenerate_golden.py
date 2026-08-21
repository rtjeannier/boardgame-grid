"""Rewrite the golden files. Run deliberately, never from a test.

    python -m tests.regenerate_golden

A golden that regenerates itself proves nothing, so this is a separate command.
Regenerate only when a change is *meant* to move the picks, and say in the
commit which of the four numbers moved and why — see `pipeline/report.py`.
"""

import json

from pipeline import buckets, dataset
from pipeline.assign import CoverageScorer, allocate
from pipeline.config import (ALTERNATES_PER_CELL, PICKS_PER_CELL, SEED_DATASET,
                             WEIGHT_ROW_COUNT)
from pipeline.features import build_feature_space

from .conftest import GOLDEN, picks_digest


def main() -> None:
    _, _, games = dataset.load_dataset(SEED_DATASET)
    space = build_feature_space(games)
    rows = buckets.build_weight_rows([g.weight for g in games], WEIGHT_ROW_COUNT)
    cells, memberships = buckets.build_cells(
        games, [buckets.PlayerCountAxis(), buckets.WeightAxis(rows)])
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of)
    results = allocate(cells, memberships, scorer, PICKS_PER_CELL,
                       alternates_limit=ALTERNATES_PER_CELL)

    GOLDEN.mkdir(parents=True, exist_ok=True)
    path = GOLDEN / "seed_picks.json"
    path.write_text(json.dumps(picks_digest(results), indent=2, sort_keys=True))
    picks = sum(len(v) for v in picks_digest(results).values())
    print(f"Wrote {path.relative_to(GOLDEN.parent.parent)} — {picks} picks over {len(results)} cells")


if __name__ == "__main__":
    main()
