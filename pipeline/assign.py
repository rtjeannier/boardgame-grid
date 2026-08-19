"""Choosing which games to show, in one place, for any stratification.

There is a single allocator here — `allocate` — and it makes no assumptions
about what the cells mean. Hand it the two-axis grid and it fills the grid; hand
it a single cell holding every game and it builds a collection. `build.py` and
`collection.py` differ only in the axes they pass and what they do with the
result.

Two concerns are kept apart:

* **The allocator** owns cells, rounds, exclusivity and stopping. A game is
  placed at most once across the whole space, contested games go to whichever
  cell values them most, and every cell takes its first pick before any cell
  takes its second — so a thin cell can't be picked clean by a well-stocked
  neighbour helping itself repeatedly.
* **A `Scorer`** owns "what is this game worth to this cell right now" and
  nothing else. Swapping selection strategy means writing one of these, not
  another allocation loop.

Every round is scored the same way, including the first. The opening pick used
to be forced to the best-ranked game, because under L2-normalised loadings a
game's value against an empty cell grew with how many genres it touched and the
widest sprawl won regardless of quality. L1 removed that: `sum(w) = membership x
quality`, so an empty cell's best bid is already its best-rated, best-fitting
game. Forcing rank on top of that only overrode membership — it opened the solo
column with games that were 35% solo.
"""

import math
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from . import coverage
from .archetypes import archetypes_for, primary_archetype
from .config import GAIN_FLOOR, MMR_LAMBDA
from .model import Game


@dataclass
class Assignment:
    archetype: str
    game: Game
    gain: float | None = None   # what the scorer valued this pick at


@dataclass
class CellResult:
    assignments: list[Assignment]
    alternates: list[Game]      # reached this cell but went unpicked


# --- Scorers ----------------------------------------------------------------

class Scorer(Protocol):
    """What is a game worth to a cell, given what that cell already holds?"""

    def begin(self, cells: dict, memberships: dict) -> None:
        """Precompute per-cell state before allocation starts."""
        ...

    def score(self, key: tuple, game: Game) -> float:
        """Marginal value of adding `game` to cell `key` right now."""
        ...

    def take(self, key: tuple, game: Game) -> None:
        """Record that `game` is now in `key`. Also used to seed anchors."""
        ...

    def reset_cell(self, key: tuple) -> None:
        """Forget everything placed in `key`, so it can be replayed.

        The repair pass rebuilds a cell by resetting it and re-`take`-ing what
        remains, which keeps rollback logic out of every scorer.
        """
        ...


class CoverageScorer:
    """Probabilistic radar coverage — the default (see pipeline/coverage.py).

    A game covers each genre axis with "probability" membership x quality x
    loading, and a set covers an axis unless all of them miss it. Value is the
    still-uncovered area a game would fill, damped by how similar it is to what
    the cell already holds so a re-implementation cannot claim credit for ground
    its sibling already covers.
    """

    def __init__(self, loadings: dict, similarity: dict | None = None):
        self.loadings = loadings
        self.similarity = similarity

    def begin(self, cells, memberships):
        self.weights = {}
        for key, pool in cells.items():
            ranks = [g.rank for g in pool]
            for game in pool:
                q = coverage.quality(game.rank, ranks)
                self.weights[(key, game.id)] = memberships[(key, game.id)] * q * self.loadings[game.id]
        n_axes = len(next(iter(self.loadings.values())))
        self.uncovered = {key: np.ones(n_axes) for key in cells}
        self.chosen = {key: [] for key in cells}

    def score(self, key, game):
        raw = float(self.weights[(key, game.id)] @ self.uncovered[key])
        return raw * coverage.novelty(game.id, self.chosen[key], self.similarity)

    def take(self, key, game):
        self.uncovered[key] *= 1.0 - self.weights[(key, game.id)]
        self.chosen[key].append(game.id)

    def reset_cell(self, key):
        self.uncovered[key] = np.ones(len(self.uncovered[key]))
        self.chosen[key] = []

    def weight_of(self, key, game) -> np.ndarray:
        """The game's quality- and membership-scaled loading vector in this cell.

        Serialised so the frontend radar draws the same numbers selection saw.
        """
        return self.weights[(key, game.id)]


class MmrScorer:
    """Maximal marginal relevance: rank blended with distance from the picks.

    `score = lambda*quality + (1-lambda)*min-distance-to-picks`, both normalised
    within the cell. Two near-identical games can't both score well early,
    however well-ranked — the same "one worker placement per cell" idea as
    coverage, but grounded in geometry rather than in filling a chart.
    """

    def __init__(self, vectors: dict):
        self.vectors = vectors

    def begin(self, cells, memberships):
        self.chosen = {key: [] for key in cells}
        self.quality, self.scale = {}, {}
        for key, pool in cells.items():
            ranks = np.array([g.rank for g in pool], dtype=float)
            span = max(ranks.max() - ranks.min(), 1.0)
            for game in pool:
                # best rank in the cell -> 1.0, worst -> 0.0
                self.quality[(key, game.id)] = 1.0 - (game.rank - ranks.min()) / span
            pts = np.stack([self.vectors[g.id] for g in pool])
            spread = np.linalg.norm(pts[:, None, :] - pts[None, :, :], axis=2).max()
            self.scale[key] = max(float(spread), 1e-9)   # the cell's own diameter

    def score(self, key, game):
        picks = self.chosen[key]
        if not picks:
            return self.quality[(key, game.id)]
        here = self.vectors[game.id]
        nearest = min(float(np.linalg.norm(here - self.vectors[p])) for p in picks)
        return (MMR_LAMBDA * self.quality[(key, game.id)]
                + (1 - MMR_LAMBDA) * nearest / self.scale[key])

    def take(self, key, game):
        self.chosen[key].append(game.id)

    def reset_cell(self, key):
        self.chosen[key] = []


class ArchetypeScorer:
    """One game per archetype — the original taxonomy walk, as a score.

    A game is worth taking only while its most-defining archetype is still
    unclaimed in this cell; among claimable games, better-ranked wins. Kept as a
    baseline against the continuous feature space.
    """

    def begin(self, cells, memberships):
        self.taken = {key: set() for key in cells}

    def _free(self, key, game) -> str | None:
        return next((a.label for a in archetypes_for(game.signals)
                     if a.label not in self.taken[key]), None)

    def score(self, key, game):
        if self._free(key, game) is None:
            return 0.0
        # Monotonic in rank so later rounds still prefer better games.
        return 1.0 / (1.0 + math.log10(max(game.rank, 1)))

    def take(self, key, game):
        claimed = self._free(key, game)
        if claimed:
            self.taken[key].add(claimed)

    def reset_cell(self, key):
        self.taken[key] = set()


# --- The allocator ----------------------------------------------------------

def allocate(cells: dict, memberships: dict, scorer: Scorer, max_per_cell: int,
             seeded: dict | None = None, alternates_limit: int = 0,
             gain_floor: float = GAIN_FLOOR) -> dict:
    """Fill every cell, placing each game at most once across all of them.

    `cells` maps key -> [Game] and `memberships` maps (key, game id) -> degree,
    both from `buckets.build_cells`. `seeded` pre-places games in a cell without
    them competing for a slot — the collection builder's anchors.

    Rounds, not one long greedy: every cell bids, a contested game goes to
    whichever cell scores it highest, losers re-bid, and nothing commits until
    the round ends.
    """
    keys = sorted(cells)                 # deterministic: contests must not
    scorer.begin(cells, memberships)     # hinge on dict iteration order

    chosen = {key: [] for key in keys}
    gains: dict[tuple, float] = {}
    taken: set[int] = set()

    for key, games in (seeded or {}).items():
        for game in games:
            scorer.take(key, game)
            chosen[key].append(game)
            taken.add(game.id)

    for _ in range(max_per_cell):
        awards = _bid_round(keys, cells, memberships, scorer, chosen, taken,
                            max_per_cell, gain_floor)
        if not awards:
            break
        for key, (game, gain) in awards.items():
            taken.add(game.id)
            gains[(key, game.id)] = gain
            scorer.take(key, game)
            chosen[key].append(game)

    _repair(keys, memberships, scorer, chosen, gains, max_per_cell, seeded or {})

    results = {}
    for key in keys:
        picked = {g.id for g in chosen[key]}
        leftovers = sorted(
            (g for g in cells[key] if g.id not in picked and g.id not in taken),
            key=lambda g: g.rank,
        )
        results[key] = CellResult(
            [Assignment(_display_label(g), g,
                        round(gains[(key, g.id)], 3) if (key, g.id) in gains else None)
             for g in chosen[key]],
            leftovers[:alternates_limit],
        )
    return results


def _bid_round(keys, cells, memberships, scorer, chosen, taken, max_per_cell,
               gain_floor) -> dict:
    """One round of deferred acceptance; returns {cell key: (Game, score)}."""
    held: dict[int, tuple] = {}          # game id -> (cell key, score, Game)
    blocked: dict[tuple, set[int]] = {key: set() for key in keys}
    pending = [k for k in keys if len(chosen[k]) < max_per_cell]

    while pending:
        key = pending.pop(0)
        best, best_score, best_sort = None, 0.0, None
        for game in cells[key]:
            if game.id in taken or game.id in blocked[key]:
                continue
            value = scorer.score(key, game)
            if value < gain_floor:
                continue
            # Membership breaks ties, so a game is never claimed by a cell it
            # barely reaches while one centred on it wants the same game.
            sort = (value, memberships[(key, game.id)])
            if best_sort is None or sort > best_sort:
                best, best_score, best_sort = game, value, sort
        if best is None:
            continue                     # nothing left worth taking this round

        incumbent = held.get(best.id)
        if incumbent is None:
            held[best.id] = (key, best_score, best)
        elif best_score > incumbent[1]:
            held[best.id] = (key, best_score, best)
            blocked[incumbent[0]].add(best.id)
            pending.append(incumbent[0])  # displaced cell bids again
        else:
            blocked[key].add(best.id)
            pending.append(key)

    return {key: (game, score) for _, (key, score, game) in held.items()}


def _repair(keys, memberships, scorer, chosen, gains, max_per_cell, seeded) -> None:
    """Move a game if some cell with room would value it more.

    A round commits its awards together, so a cell that valued a game more may
    not have bid on it before it was claimed. Rare — a handful of cells on a
    35-cell grid — but cheap to correct, and it makes the result independent of
    the order cells happened to bid in.

    Seeded games (the collection's anchors) are pinned: they were placed by the
    caller, not won, so they are not the allocator's to move.
    """
    pinned = {(key, g.id) for key, games in seeded.items() for g in games}

    def replay(key, games):
        scorer.reset_cell(key)
        for game in games:
            scorer.take(key, game)

    for _ in range(len(keys)):            # bounded; converges in a pass or two
        moved = False
        for key in keys:
            for game in list(chosen[key]):
                if (key, game.id) in pinned:
                    continue
                here = scorer.score(key, game)
                for other in keys:
                    if other == key or len(chosen[other]) >= max_per_cell:
                        continue
                    if (other, game.id) not in memberships:
                        continue          # game doesn't reach that cell at all
                    there = scorer.score(other, game)
                    if there > here + 1e-9:
                        chosen[key].remove(game)
                        gains.pop((key, game.id), None)
                        replay(key, chosen[key])
                        chosen[other].append(game)
                        gains[(other, game.id)] = there
                        scorer.take(other, game)
                        moved = True
                        break
                if moved:
                    break
            if moved:
                break
        if not moved:
            return


def _display_label(game: Game) -> str:
    """Cosmetic type label for a pick — selection never depends on it."""
    arch = primary_archetype(game.signals)
    return arch.label if arch else "Other"
