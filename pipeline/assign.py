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
* `MmrAssigner` and `GreedyAssigner` treat each cell **independently**, so
  `assign_grid` maps over cells and is trivially parallelisable.
* The default coverage path does **not**, and can't: games belong to several
  cells by degree (see buckets.cell_memberships), so something has to decide
  which cell gets a contested game and ensure no game is shown twice. That lives
  in `assign_grid_coverage` below, which allocates across the whole grid at once.
"""

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from . import coverage
from .archetypes import archetypes_for, primary_archetype
from .config import GAIN_FLOOR, MMR_LAMBDA, PICKS_PER_CELL
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

    def __init__(self, loadings: dict[int, "np.ndarray"],
                 similarity: dict[int, "np.ndarray"] | None = None):
        self.loadings = loadings      # from features.build_feature_space
        self.similarity = similarity  # full-space vectors; suppresses duplicates

    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        ranks = [g.rank for g in games]
        candidates = [
            (g, coverage.quality(g.rank, ranks) * self.loadings[g.id])
            for g in games
        ]
        picks = coverage.greedy_fill(candidates, seed=[], max_picks=PICKS_PER_CELL,
                                     similarity=self.similarity)

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


# --- Grid-wide coverage allocation (the default) -----------------------------

def assign_grid_coverage(cells: dict, memberships: dict, loadings: dict,
                         similarity: dict | None, alternates_limit: int) -> dict:
    """Allocate games across the whole grid so each is picked at most once.

    `cells` maps (col, row) -> [Game]; `memberships` maps ((col, row), game id)
    -> how strongly that game belongs there. A game appears in several pools, so
    per-cell greedy would show it in several cells at once.

    Rounds, not one long greedy: every cell bids for its best remaining game,
    a contested game goes to whichever cell gains most, and losers re-bid before
    anything is committed. That way **every cell takes its first pick before any
    cell takes its second**, so a thin cell can't be picked clean by a
    well-stocked neighbour helping itself two or three times first. Allocating
    strictly by highest-gain-anywhere scores marginally better on paper but
    offers thin cells no such protection.

    A game's coverage weight is `membership x quality x loadings`, so a game
    centred in a cell counts fully and one that merely reaches it counts less --
    reusing `quality` rather than inventing a parallel mechanism.
    """
    keys = sorted(cells)                     # deterministic: contests must not
    n_axes = len(next(iter(loadings.values())))   # hinge on dict iteration order

    weights, ranks_by_cell = {}, {}
    for key in keys:
        pool = cells[key]
        ranks = [g.rank for g in pool]
        ranks_by_cell[key] = ranks
        for game in pool:
            q = coverage.quality(game.rank, ranks)
            weights[(key, game.id)] = memberships[(key, game.id)] * q * loadings[game.id]

    uncovered = {key: np.ones(n_axes) for key in keys}
    chosen: dict[tuple, list[Game]] = {key: [] for key in keys}
    gains: dict[tuple, float] = {}
    taken: set[int] = set()

    for round_index in range(PICKS_PER_CELL):
        # Round 1 bids by *rank*, later rounds by coverage gain. Against an empty
        # radar the gain of a game is just the sum of its loadings, so a game
        # sprawling over eight genre axes outscores a focused one however much
        # better it is — that is how Brass: Birmingham (#1, 4 axes) lost its cell
        # to Skat (#2489, 3 axes) by way of a pile of 8-axis generalists. The
        # opening pick should answer "what is the best game here", and coverage
        # takes over once there is something on the chart to complement.
        awards = _bid_round(keys, cells, memberships, weights, uncovered,
                            chosen, taken, similarity, by_rank=(round_index == 0))
        if not awards:
            break
        for key, (game, gain) in awards.items():
            taken.add(game.id)
            gains[(key, game.id)] = gain
            uncovered[key] *= 1.0 - weights[(key, game.id)]
            chosen[key].append(game)

    _repair(keys, cells, weights, uncovered, chosen, gains, similarity)

    results = {}
    for key in keys:
        picked = {g.id for g in chosen[key]}
        leftovers = sorted(
            (g for g in cells[key] if g.id not in picked and g.id not in taken),
            key=lambda g: g.rank,
        )
        results[key] = CellResult(
            [Assignment(_display_label(g), g, round(gains[(key, g.id)], 3))
             for g in chosen[key]],
            leftovers[:alternates_limit],
        )
    return results


def _gain(key, game, weights, uncovered, chosen, similarity) -> float:
    raw = float(weights[(key, game.id)] @ uncovered[key])
    return raw * coverage.novelty(game.id, [g.id for g in chosen[key]], similarity)


def _bid_round(keys, cells, memberships, weights, uncovered, chosen, taken,
               similarity, by_rank: bool = False) -> dict:
    """One round of deferred acceptance; returns {cell key: (Game, gain)}.

    `by_rank` makes cells bid for their best-ranked game rather than their
    highest-gain one — used for the opening round only, see the caller.
    """
    held: dict[int, tuple] = {}          # game id -> (cell key, gain, Game)
    blocked: dict[tuple, set[int]] = {key: set() for key in keys}
    pending = [k for k in keys if len(chosen[k]) < PICKS_PER_CELL]

    while pending:
        key = pending.pop(0)
        best, best_gain, best_sort = None, GAIN_FLOOR, None
        for game in cells[key]:
            if game.id in taken or game.id in blocked[key]:
                continue
            gain = _gain(key, game, weights, uncovered, chosen, similarity)
            if by_rank:
                # Membership first so a game is not claimed by a cell it barely
                # reaches, then rank. Gain still has to clear the floor.
                if gain < GAIN_FLOOR:
                    continue
                sort = (memberships[(key, game.id)], -game.rank)
                if best_sort is None or sort > best_sort:
                    best, best_gain, best_sort = game, gain, sort
            elif gain > best_gain or (best is not None and gain == best_gain and (
                    memberships[(key, game.id)], -game.rank)
                    > (memberships[(key, best.id)], -best.id)):
                best, best_gain = game, gain
        if best is None:
            continue                      # nothing left worth taking this round

        incumbent = held.get(best.id)
        if incumbent is None:
            held[best.id] = (key, best_gain, best)
        elif best_gain > incumbent[1]:
            held[best.id] = (key, best_gain, best)
            blocked[incumbent[0]].add(best.id)
            pending.append(incumbent[0])  # displaced cell bids again
        else:
            blocked[key].add(best.id)
            pending.append(key)

    return {key: (game, gain) for _, (key, gain, game) in held.items()}


def _repair(keys, cells, weights, uncovered, chosen, gains, similarity) -> None:
    """Move a game if some cell with room would gain more from it.

    A round commits its awards together, so a cell that valued a game more may
    not have bid on it before it was claimed. Rare (one placement in a 238-pick
    grid) but cheap to correct, and it makes the result order-independent.
    """
    for _ in range(len(keys)):            # bounded; converges in a pass or two
        moved = False
        for key in keys:
            for game in list(chosen[key]):
                here = _gain(key, game, weights, uncovered, chosen, similarity)
                for other in keys:
                    if other == key or len(chosen[other]) >= PICKS_PER_CELL:
                        continue
                    if (other, game.id) not in weights:
                        continue
                    there = _gain(other, game, weights, uncovered, chosen, similarity)
                    if there > here + 1e-9:
                        chosen[key].remove(game)
                        gains.pop((key, game.id), None)
                        uncovered[key] = np.ones(len(uncovered[key]))
                        for kept in chosen[key]:
                            uncovered[key] *= 1.0 - weights[(key, kept.id)]
                        chosen[other].append(game)
                        gains[(other, game.id)] = there
                        uncovered[other] *= 1.0 - weights[(other, game.id)]
                        moved = True
                        break
                if moved:
                    break
            if moved:
                break
        if not moved:
            return
