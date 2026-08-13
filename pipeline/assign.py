"""Choosing which of a cell's games to show (the coverage/de-duplication step).

This is the interesting, swappable part of the pipeline. Given the games that
qualify for a single cell, an *assigner* picks a diverse subset — so a cell
never shows five near-identical worker-placement games.

Three strategies live here:
* `CoverageAssigner` (default) — probabilistic radar-chart coverage.
* `MmrAssigner` — maximal marginal relevance (pairwise distance).
* `GreedyAssigner` — the original one-game-per-archetype taxonomy walk.

Design notes
------------
* `Assigner` is a tiny protocol — swap in a different strategy (ILP, weighted
  matching, ML-ranked, ...) by writing one `assign()` method.
* Each cell is assigned **independently** of every other cell, so the grid is
  embarrassingly parallel: `assign_grid` maps the assigner over cells and could
  be handed to a thread/process pool unchanged. We keep it sequential here
  because the work is tiny; the independence is the point.
"""

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from . import coverage
from .archetypes import archetypes_for, primary_archetype
from .config import MMR_LAMBDA, PICKS_PER_CELL
from .model import Game


@dataclass
class Assignment:
    archetype: str
    game: Game
    gain: float | None = None   # coverage added when picked (CoverageAssigner only)


@dataclass
class CellResult:
    assignments: list[Assignment]   # one game per claimed archetype
    alternates: list[Game]          # qualified games that didn't get a slot


class Assigner(Protocol):
    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        """Choose one game per archetype from the games qualifying for a cell."""
        ...


class CoverageAssigner:
    """Fill the cell's genre radar chart (see pipeline/coverage.py).

    Every game covers each genre axis with probability quality × loading;
    greedy adds whatever covers the most still-empty area and stops when
    nothing left would add much — so a rich cell gets more picks than a thin
    one, and a near-duplicate of an earlier pick never makes the cut.
    """

    def __init__(self, loadings: dict[int, "np.ndarray"]):
        self.loadings = loadings  # from features.build_feature_space

    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        ranks = [g.rank for g in games]
        candidates = [
            (g, coverage.quality(g.rank, ranks) * self.loadings[g.id])
            for g in games
        ]
        picks = coverage.greedy_fill(candidates, seed=[], max_picks=PICKS_PER_CELL)

        assignments = [Assignment(_display_label(p.game), p.game, p.gain) for p in picks]
        chosen = {p.game.id for p in picks}
        leftovers = sorted((g for g in games if g.id not in chosen), key=lambda g: g.rank)
        return CellResult(assignments, leftovers[:alternates_limit])


class MmrAssigner:
    """Maximal-marginal-relevance coverage in the continuous feature space.

    Start with the best-ranked game, then repeatedly add the game with the best
    blend of quality and distance from everything already picked:

        score = λ·quality + (1-λ)·min-distance-to-picks

    with quality and distances normalised to [0, 1] within the cell. Two
    near-identical games can't both get picked early, however well-ranked —
    which is the whole "one worker placement per cell" idea, but grounded in
    geometry instead of hand-made labels. Labels (each pick's primary
    archetype) are kept purely for display and may legitimately repeat.
    """

    def __init__(self, vectors: dict[int, np.ndarray]):
        self.vectors = vectors  # from features.build_feature_space

    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        ranked = sorted(games, key=lambda g: g.rank)
        points = np.stack([self.vectors[g.id] for g in ranked])

        # Quality: best rank in the cell -> 1.0, worst -> 0.0.
        ranks = np.array([g.rank for g in ranked], dtype=float)
        quality = 1.0 - (ranks - ranks.min()) / max(ranks.max() - ranks.min(), 1.0)

        # Pairwise distances, normalised by the cell's own diameter so λ blends
        # two like-scaled quantities.
        diffs = points[:, None, :] - points[None, :, :]
        dist = np.linalg.norm(diffs, axis=2)
        dist /= max(dist.max(), 1e-9)

        picked = [0]  # the best-ranked game always leads
        while len(picked) < min(PICKS_PER_CELL, len(ranked)):
            remaining = [i for i in range(len(ranked)) if i not in picked]
            spread = dist[np.ix_(remaining, picked)].min(axis=1)
            scores = MMR_LAMBDA * quality[remaining] + (1 - MMR_LAMBDA) * spread
            picked.append(remaining[int(np.argmax(scores))])

        assignments = [Assignment(_display_label(ranked[i]), ranked[i]) for i in picked]
        leftovers = [g for i, g in enumerate(ranked) if i not in picked]
        return CellResult(assignments, leftovers[:alternates_limit])


def _display_label(game: Game) -> str:
    """Cosmetic type label for a pick — selection never depends on it."""
    arch = primary_archetype(game.signals)
    return arch.label if arch else "Other"


class GreedyAssigner:
    """Walk games best-rank-first; each claims its most-defining free archetype.

    Because we go in rank order, the top-ranked game gets first pick of its
    signature archetype, the next game takes the best archetype still open, and
    so on. Simple, fast, and produces an intuitive "best of each type" cell.
    """

    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        ranked = sorted(games, key=lambda g: g.rank)
        taken: set[str] = set()
        assignments: list[Assignment] = []
        leftovers: list[Game] = []

        for game in ranked:
            claimed = next(
                (a.label for a in archetypes_for(game.signals) if a.label not in taken),
                None,
            )
            if claimed:
                taken.add(claimed)
                assignments.append(Assignment(claimed, game))
            else:
                leftovers.append(game)

        return CellResult(assignments, leftovers[:alternates_limit])


def assign_grid(cells: dict, assigner: Assigner, alternates_limit: int) -> dict:
    """Apply an assigner to every cell. `cells` maps (col, row) -> [Game].

    Returns the same keys mapped to `CellResult`. Cells are independent, so this
    map is trivially parallelisable if a strategy ever gets expensive.
    """
    return {key: assigner.assign(games, alternates_limit) for key, games in cells.items()}
