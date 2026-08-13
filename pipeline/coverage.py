"""Probabilistic coverage: the radar-chart selection model.

Picture a radar chart with one spoke per latent genre dimension. Each game
covers every axis with "probability" quality × loading, and a set of games
covers an axis unless *all* of them miss it:

    coverage(axis) = 1 - ∏ (1 - w_i)          over games i in the set

A candidate's marginal gain is therefore Σ w·(uncovered space) — literally
"how much of the empty chart it fills". Coverage functions are submodular, so
the greedy loop below is guaranteed near-optimal (≥ 1-1/e of the best set).

Used by both the per-cell CoverageAssigner (pipeline/assign.py) and the
whole-collection builder (pipeline/collection.py).
"""

from dataclasses import dataclass

import numpy as np

from .config import GAIN_FLOOR, QUALITY_FLOOR
from .model import Game


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


@dataclass
class Pick:
    game: Game
    gain: float          # total coverage this game added when it was picked


def greedy_fill(candidates: list[tuple[Game, np.ndarray]],
                seed: list[np.ndarray],
                max_picks: int,
                gain_floor: float = GAIN_FLOOR) -> list[Pick]:
    """Greedily pick games that cover the most still-uncovered radar area.

    `candidates` are (game, quality-scaled weights) pairs; `seed` is the
    weights of already-owned games (anchors, or empty). Stops when the best
    remaining gain drops below `gain_floor` — a cell/collection that is
    already well covered naturally takes fewer picks.

    When starting from nothing (no seed), the best-*ranked* game leads
    unconditionally — the chart is empty, so "what's the best game here" beats
    "what covers widest"; pure gain would favour multi-genre generalists over
    a clearly better focused game. Coverage drives every pick after that.
    """
    n_axes = len(seed[0]) if seed else (len(candidates[0][1]) if candidates else 0)
    uncovered = 1.0 - axis_coverage(seed, n_axes)

    picks: list[Pick] = []
    remaining = list(candidates)
    if not seed and remaining:
        lead = min(range(len(remaining)), key=lambda i: remaining[i][0].rank)
        game, w = remaining.pop(lead)
        picks.append(Pick(game, round(float(w @ uncovered), 3)))
        uncovered *= 1.0 - w

    while remaining and len(picks) < max_picks:
        gains = [float(w @ uncovered) for _, w in remaining]
        best = int(np.argmax(gains))
        if gains[best] < gain_floor:
            break
        game, w = remaining.pop(best)
        picks.append(Pick(game, round(gains[best], 3)))
        uncovered *= 1.0 - w
    return picks


def unique_contribution(index: int, weight_rows: list[np.ndarray]) -> float:
    """Total coverage lost if member `index` were removed from the set.

    The honesty stat: an anchor whose unique contribution has shrunk to ~0 has
    been made redundant by later picks — we report it rather than prevent it.
    """
    n_axes = len(weight_rows[0])
    full = axis_coverage(weight_rows, n_axes)
    without = axis_coverage(weight_rows[:index] + weight_rows[index + 1:], n_axes)
    return round(float((full - without).sum()), 3)
