"""`score` and `score_all` must agree, because both are live.

`score_all` answers a whole cell at once and is what `_bid_round` uses;
`score` answers one game and is what `_repair` and the re-recording pass use.
Two implementations of one formula is exactly the drift risk this repo already
carries once (`web/src/coverage.js` mirrors `coverage.axis_coverage` with only a
comment holding them together), so this pins them.

They agree to about one ulp rather than bit-for-bit: a matrix-vector product
accumulates in a different order than a sequence of dot products, and no BLAS
guarantees otherwise. What has to hold is the *ordering* — that is what picks a
winner — so both are asserted.
"""

import numpy as np
import pytest

from pipeline import buckets
from pipeline.assign import CoverageScorer
from pipeline.params import DEFAULTS

TOLERANCE = 1e-12          # observed max deviation is ~1.1e-16


@pytest.fixture(scope="module")
def scorer_state(seed_build):
    games, space = seed_build["games"], seed_build["space"]
    sel, coll = DEFAULTS.selection, DEFAULTS.collection
    rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)
    cells, memb = buckets.build_cells(
        games, [buckets.PlayerCountAxis(coll.columns(), sel),
                buckets.WeightAxis(rows, sel)], sel)
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of, sel)
    scorer.begin(cells, memb)
    return scorer, cells


def _check(scorer, cells, key):
    one = np.array([scorer.score(key, g) for g in cells[key]])
    many = scorer.score_all(key)
    assert np.allclose(one, many, rtol=0, atol=TOLERANCE), \
        f"max deviation {np.abs(one - many).max():.3e}"
    # Ordering is what actually decides a slot.
    assert np.array_equal(np.argsort(-one, kind="stable"),
                          np.argsort(-many, kind="stable"))


def test_agree_on_an_untouched_grid(scorer_state):
    scorer, cells = scorer_state
    for key in sorted(cells, key=lambda k: -len(cells[k]))[:3]:
        _check(scorer, cells, key)


def test_agree_once_a_cell_has_picks(scorer_state):
    """The per-cell novelty term: one path maxes over picks, the other keeps a
    running maximum updated in `take`."""
    scorer, cells = scorer_state
    key = max(cells, key=lambda k: len(cells[k]))
    for game in cells[key][:4]:
        scorer.take(key, game)
    _check(scorer, cells, key)


def test_agree_once_the_shelf_is_not_empty(scorer_state):
    """The collection term, including a cell that holds an already-shelved game."""
    scorer, cells = scorer_state
    keys = sorted(cells, key=lambda k: -len(cells[k]))
    for game in cells[keys[1]][:3]:
        scorer.take(keys[1], game)
    for key in keys[:3]:
        _check(scorer, cells, key)


def test_agree_after_a_cell_is_replayed(scorer_state):
    """`reset_cell` has to unwind the running maximum and the shelf columns."""
    scorer, cells = scorer_state
    key = max(cells, key=lambda k: len(cells[k]))
    scorer.reset_cell(key)
    _check(scorer, cells, key)
    for game in cells[key][:2]:
        scorer.take(key, game)
    _check(scorer, cells, key)
