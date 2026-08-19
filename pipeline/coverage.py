"""Probabilistic coverage: the radar-chart selection model.

Picture a radar chart with one spoke per latent genre dimension. Each game
covers every axis with "probability" quality × loading, and a set of games
covers an axis unless *all* of them miss it:

    coverage(axis) = 1 - ∏ (1 - w_i)          over games i in the set

A candidate's marginal gain is therefore Σ w·(uncovered space) — literally
"how much of the empty chart it fills". Coverage functions are submodular, so
greedy selection over them is near-optimal (≥ 1-1/e of the best set).

This module is the maths only — `quality`, `axis_coverage`, `novelty`,
`unique_contribution`. Choosing games with it lives in `pipeline/assign.py`,
which drives one allocator over any stratification: the two-axis grid, or a
single cell holding the whole space for the collection builder.
"""

import numpy as np

from .config import QUALITY_FLOOR, SIMILARITY_EXPONENT


def quality(rank: int, ranks: list[int]) -> float:
    """Map a game's rank to [QUALITY_FLOOR, 1] by percentile within its pool.

    The best game in the pool covers at its full genre loadings; the worst
    still covers at QUALITY_FLOOR of them — good games cast bigger shadows on
    the radar chart, but no game is invisible.
    """
    if len(ranks) < 2:
        return 1.0
    worse = sum(r > rank for r in ranks)
    return QUALITY_FLOOR + (1 - QUALITY_FLOOR) * worse / (len(ranks) - 1)


def axis_coverage(weight_rows: list[np.ndarray], n_axes: int) -> np.ndarray:
    """Per-axis coverage of a set: 1 - ∏(1 - w). Empty set covers nothing."""
    uncovered = np.ones(n_axes)
    for w in weight_rows:
        uncovered *= 1.0 - w
    return 1.0 - uncovered


def novelty(game_id: int,
            chosen_ids: list[int],
            similarity: dict[int, np.ndarray] | None) -> float:
    """How much of this game is *not* already on the shelf, in [0, 1].

    Why this exists: `axis_coverage` treats each game's coverage as an
    independent event, which is wrong for duplicates — two copies of one game
    are perfectly correlated, not independent. So a clone collects credit on
    every axis its original only partly covers, worth `sum(w) - 1` (0.65 for
    Twilight Imperium, 1.24 for Wingspan) — comfortably above GAIN_FLOOR. That
    is how both Twilight Imperium editions ended up in one cell.

    Scaling by this factor removes the credit at its source. Similarity is the
    max over picks, never the mean: the question is "is this a duplicate of *any
    one* game I hold", and a mean dilutes that with irrelevant comparisons,
    growing weaker exactly as the set fills up.
    """
    if similarity is None or not chosen_ids:
        return 1.0
    here = similarity[game_id]
    closest = max(float(here @ similarity[other]) for other in chosen_ids)
    return 1.0 - max(closest, 0.0) ** SIMILARITY_EXPONENT


def unique_contribution(index: int, weight_rows: list[np.ndarray]) -> float:
    """Total coverage lost if member `index` were removed from the set.

    The honesty stat: an anchor whose unique contribution has shrunk to ~0 has
    been made redundant by later picks — we report it rather than prevent it.
    """
    n_axes = len(weight_rows[0])
    full = axis_coverage(weight_rows, n_axes)
    without = axis_coverage(weight_rows[:index] + weight_rows[index + 1:], n_axes)
    return round(float((full - without).sum()), 3)
