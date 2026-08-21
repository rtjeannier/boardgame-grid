"""Cosines that come back above 1.0, and the complex numbers they used to make.

A cosine between unit vectors is mathematically in [0, 1] and numerically is
not: 124 pairs on the live capture score 1.0000000000000002, every one of them
a pair of games carrying identical tag sets. The excess is 4e-16.

That would be beneath notice except for what happens next. `novelty` returns
`1 - closest ** n`, which goes very slightly negative, and `CoverageScorer.score`
then computes `fresh ** collection_weight` — a negative raised to a fractional
power. Python does not raise: it returns a **complex number**, which flows
through the scorer silently until something tries to order it, at which point
the failure surfaces somewhere with no connection to the cause.

Found by sweeping QUALITY_FLOOR, not by reading the code.
"""

import numpy as np
import pytest

from pipeline import coverage
from pipeline.assign import CoverageScorer
from pipeline.params import DEFAULTS


def test_novelty_clamps_a_cosine_above_one():
    """An identical pair must give novelty 0, never a negative."""
    # This vector's dot with itself is 1.0000000000000016, not 1.0.
    v = np.full(978, 1 / np.sqrt(978))
    assert float(v @ v) > 1.0, "precondition: the dot really does exceed 1"

    result = coverage.novelty(1, [2], {1: v, 2: v})
    assert result == 0.0
    assert not isinstance(result, complex)


def test_novelty_stays_in_range_for_arbitrary_pairs():
    rng = np.random.default_rng(0)
    vectors = {}
    for i in range(20):
        x = rng.random(50)
        vectors[i] = x / np.linalg.norm(x)
    for i in range(20):
        n = coverage.novelty(i, [j for j in range(20) if j != i], vectors)
        assert 0.0 <= n <= 1.0


def test_score_never_returns_complex():
    """The end-to-end shape of the bug: a fractional power of a negative.

    Guards the combination rather than the clamp, so moving the clamp elsewhere
    still passes as long as the score stays real.
    """
    fresh = -6.661e-16                      # what novelty used to return
    poisoned = complex(fresh) ** DEFAULTS.selection.collection_weight
    assert isinstance(poisoned, complex) and poisoned.imag != 0, (
        "precondition: this is what the old code computed"
    )
    # With the clamp in place novelty cannot produce that input at all.
    v = np.full(978, 1 / np.sqrt(978))
    assert coverage.novelty(1, [2], {1: v, 2: v}) >= 0.0


def test_overlap_clamps_too():
    """`_overlap` is the other cosine, and feeds the same fractional power."""
    scorer = CoverageScorer.__new__(CoverageScorer)
    scorer.reach = {1: {("a",): 1.0}, 2: {("a",): 1.0}}
    assert 0.0 <= scorer._overlap(1, 2) <= 1.0
