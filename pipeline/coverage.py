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

from .config import QUALITY_EXPONENT, QUALITY_FLOOR, SIMILARITY_EXPONENT


def quality(rating: float, ratings: list[float]) -> float:
    """Map a game's rating to [QUALITY_FLOOR, 1] against the whole population.

    Weighted by BGG's Bayesian average, not by rank position, and normalised
    globally rather than within a cell. Both parts matter.

    Percentile-within-cell used to squash the top flat: in an 857-game cell
    holding ranks 3 to 4991, Orleans (#35) and Rajas of the Ganges (#170) came
    out at 0.996 and 0.975 — a 135-place gap worth 0.02 — because both sat in
    the same top 5% of that pool. A game's quality also swung with whichever
    other games happened to share its cell, which is no property of the game.

    QUALITY_EXPONENT then decides how much better a better game is. Rating
    alone is a narrow band (8.39 at #1 down to 5.79 at #5000, so the whole
    ladder spans 31%); raising the normalised score to a power above 1 widens
    the gap between the top and the middle without inventing an ordering.
    """
    lo, hi = min(ratings), max(ratings)
    if hi <= lo:
        return 1.0
    normalised = (rating - lo) / (hi - lo)
    return QUALITY_FLOOR + (1 - QUALITY_FLOOR) * normalised ** QUALITY_EXPONENT


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
