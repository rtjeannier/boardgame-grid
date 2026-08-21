"""Shared fixtures. The seed build is the unit of work every test shares.

Everything here runs against `data/games.seed.json`, never the live capture:
`data/games.json`, `data/cache/` and `boardgames_ranks.csv` are all gitignored,
so the seed is the only dataset a fresh clone can reproduce. The seed is a
*smaller* dataset, not a thinner one — it carries every field a live capture
does, which is what makes it a valid fixture rather than a degraded one.
"""

import json
from pathlib import Path

import pytest

from pipeline import buckets, dataset
from pipeline.assign import CoverageScorer, allocate
from pipeline.config import (ALTERNATES_PER_CELL, PICKS_PER_CELL, SEED_DATASET,
                             WEIGHT_ROW_COUNT)
from pipeline.features import build_feature_space

GOLDEN = Path(__file__).parent / "golden"


@pytest.fixture(scope="session")
def seed_build():
    """One full selection over the seed dataset, shared by every test (~4s)."""
    source, generated_at, games = dataset.load_dataset(SEED_DATASET)
    space = build_feature_space(games)
    rows = buckets.build_weight_rows([g.weight for g in games], WEIGHT_ROW_COUNT)
    axes = [buckets.PlayerCountAxis(), buckets.WeightAxis(rows)]
    cells, memberships = buckets.build_cells(games, axes)
    ratings = {g.id: g.rating for g in games}
    scorer = CoverageScorer(space.loadings, space.similarity, ratings, space.spoke_of)
    results = allocate(cells, memberships, scorer, PICKS_PER_CELL,
                       alternates_limit=ALTERNATES_PER_CELL)
    return {
        "source": source,
        "games": games,
        "space": space,
        "cells": cells,
        "memberships": memberships,
        "results": results,
    }


def picks_digest(results) -> dict:
    """Cell key -> the games it shelved, in order, with their gains.

    Deliberately not the whole `grid.json`: that file is ~900 KB and most of it
    is display fields. What a regression test needs to pin is *what got picked
    and what it was worth* — everything else is presentation that can change
    without the selection changing.
    """
    return {
        f"{key[0]}|{key[1]}": [
            [a.game.id, a.game.name, None if a.gain is None else round(a.gain, 6)]
            for a in result.assignments
        ]
        for key, result in sorted(results.items())
    }


def load_golden(name: str) -> dict:
    return json.loads((GOLDEN / name).read_text())
