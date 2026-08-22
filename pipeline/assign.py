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
import re
from dataclasses import dataclass
from collections.abc import Callable
from typing import Protocol

import numpy as np

from . import coverage
from .archetypes import archetypes_for
from .params import DEFAULTS, Baseline, Selection
from .model import Game


@dataclass
class Assignment:
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

    On top of that, a cell strongly prefers not to take two games of the same
    *primary* genre — see GENRE_REPEAT_PENALTY. Coverage alone does not deliver
    that, because it treats a genre as a quantity to fill rather than a kind to
    represent: Dune: Imperium covers the card-game axis to 0.404, which leaves
    0.60 "unfilled", so Lost Ruins of Arnak collects 0.199 for being the same
    sort of game again. The two sat first and third in one cell.
    """

    def __init__(self, loadings: dict, similarity: dict | None, ratings: dict[int, float],
                 spoke_of: list[int] | None = None,
                 sel: Selection = DEFAULTS.selection,
                 axis_room: np.ndarray | None = None):
        self.loadings = loadings
        self.similarity = similarity
        # A game's strongest genre — the kind it counts as for the one-per-cell
        # preference, and the same axis the frontend colours its dot by.
        #
        # Judged at the *family* level when one is supplied. The axes are far
        # finer than the kinds a shelf is built from — 77 of them — so keyed on
        # the axis this barely fires: 37 cells came out holding two games of the
        # same kind, against 4 keyed on the family.
        #
        # It is the family with the largest *total*, not the family holding the
        # single strongest axis. Those disagree — a game can lean hardest on one
        # narrow axis while belonging more to a family that several of its
        # weaker axes share — and the frontend colours the dot by the total, so
        # keying on anything else makes the penalty and the colour tell
        # different stories.
        if spoke_of is None:
            self.primary = {gid: int(np.argmax(row)) for gid, row in loadings.items()}
        else:
            spoke_of = np.asarray(spoke_of)
            width = int(spoke_of.max()) + 1
            self.primary = {
                gid: int(np.argmax(np.bincount(spoke_of, weights=row, minlength=width)))
                for gid, row in loadings.items()
            }
        # Quality is judged against each game's own genre, over the WHOLE
        # population — never a cell. A game's genres belong to the game, so its
        # weights are identical wherever it is considered and scores stay
        # comparable across cells, which contests depend on. See
        # coverage.genre_quality.
        self.sel = sel
        self.genre = coverage.genre_weights(loadings, ratings, sel)
        # How much space each axis offers. A reader who discounts a genre gets a
        # *shorter spoke*: a game filling it fills less, and at zero there is
        # nothing there to gain.
        #
        # Never scaled loadings. `take` reduces `uncovered` by what a game
        # covers, so scaling a disliked genre's loadings makes that axis fill
        # more slowly — it stays the emptiest region of the chart and the
        # allocator chases it, which is the opposite of what was asked. It would
        # also move peak-relative genre membership, and with it every genre's
        # rating span, corrupting quality everywhere with nothing to flag it.
        n_axes = len(next(iter(loadings.values())))
        self.axis_room = (np.ones(n_axes) if axis_room is None
                          else np.asarray(axis_room, dtype=float))

    def begin(self, cells, memberships):
        self.weights = {}
        for key, pool in cells.items():
            for game in pool:
                self.weights[(key, game.id)] = (
                    memberships[(key, game.id)] * self.genre[game.id]
                )

        # --- the same data again, laid out for whole-pool scoring -------------
        #
        # `score` answers one game at a time and `score_all` answers a cell at
        # once. The second exists because the first is where the time goes: it
        # runs ~570,000 times on the live capture, and each call is a handful of
        # dict lookups plus several NumPy calls that cost microseconds apiece
        # whatever the array size. The arithmetic underneath is ~20M
        # multiply-adds — well under a second's work — so almost all of the 6.5s
        # was interpreter overhead rather than maths.
        #
        # Stacked once here rather than per round: a cell's candidates and their
        # weights do not change, only `uncovered` does.
        self._ids = sorted({g.id for pool in cells.values() for g in pool})
        self._row_of = {gid: i for i, gid in enumerate(self._ids)}
        self._sim = (np.stack([self.similarity[gid] for gid in self._ids])
                     if self.similarity else None)
        self.pool_ids, self.pool_w, self.pool_rows = {}, {}, {}
        self.pool_kind, self.pool_memb = {}, {}
        for key, pool in cells.items():
            self.pool_ids[key] = np.array([g.id for g in pool], dtype=np.int64)
            self.pool_w[key] = (np.stack([self.weights[(key, g.id)] for g in pool])
                                if pool else np.zeros((0, 1)))
            self.pool_rows[key] = np.array([self._row_of[g.id] for g in pool],
                                           dtype=np.int64)
            self.pool_kind[key] = np.array([self.primary[g.id] for g in pool],
                                           dtype=np.int64)
            self.pool_memb[key] = np.array([memberships[(key, g.id)] for g in pool])
        self.uncovered = {key: self.axis_room.copy() for key in cells}
        self.chosen = {key: [] for key in cells}
        self.kinds = {key: set() for key in cells}
        self.shelved = []               # every id placed anywhere, for the below
        # Similarity of every game to every shelved game, one column per shelved
        # game, grown as the shelf grows. Recomputing this inside `score_all`
        # cost O(pool x shelf x 978) *per cell per round* — 22 billion
        # multiply-adds over a full allocation, and by far the largest single
        # cost. A column is O(games x 978) once, and reading it back is a max
        # over ~175 numbers.
        self._shelf_sims = None
        self._shelf_cols: list[int] = []
        # Per cell, each candidate's similarity to the closest game that cell has
        # already picked. A running maximum, because a cell's picks only ever
        # grow between resets — so this never needs the pool x picks product that
        # dominated `score_all`.
        self.cell_closest = {key: np.zeros(len(pool)) for key, pool in cells.items()}

        # Where each game can sit, and which games BGG calls the same design.
        # Together these say whether a reimplementation actually went anywhere.
        self.reach = {}
        for (key, gid), degree in memberships.items():
            self.reach.setdefault(gid, {})[key] = degree
        self.kin = {}
        for pool in cells.values():
            for game in pool:
                self.kin[game.id] = set(game.reimplements)
        self._ground = {}

    def score(self, key, game):
        raw = float(self.weights[(key, game.id)] @ self.uncovered[key])
        value = raw * coverage.novelty(game.id, self.chosen[key], self.similarity,
                                       self.sel)
        if self.primary[game.id] in self.kinds[key]:
            value *= self.sel.genre_repeat_penalty
        # ...and a gentler pull from the rest of the shelf. Filling this cell is
        # the point; that the collection already holds three deck-builders only
        # makes a fourth slightly less welcome, wherever it sits. A second
        # edition of something already shelved is the far end of the same idea
        # rather than a separate rule.
        #
        # This has to be similarity, not coverage: a collection-wide `uncovered`
        # is near zero on every axis after a hundred-odd picks, so it damps
        # everything equally instead of telling duplicates from newcomers.
        #
        # Note the first round feels none of this — nothing is shelved yet — so
        # the best game for a cell always wins its slot, and the pull only
        # builds over later rounds.
        if self.sel.collection_weight and self.shelved:
            # Excluding the game itself: the repair pass scores games that are
            # already placed, and a game is not a duplicate of itself.
            others = [gid for gid in self.shelved if gid != game.id]
            if others:
                fresh = coverage.novelty(game.id, others, self.similarity, self.sel)
                fresh = min(fresh, 1.0 - self._redone(game.id, others)
                            ** self.sel.similarity_exponent)
                value *= fresh ** self.sel.collection_weight
        return value

    def score_all(self, key) -> np.ndarray:
        """Every candidate in one cell, scored together. Mirrors `score` exactly.

        Same quantities in the same order — raw coverage gain, novelty against
        this cell's picks, the one-per-kind preference, then the pull from the
        rest of the shelf — computed over the whole pool instead of one game at
        a time. Returns scores positionally aligned with `cells[key]`; the caller
        masks out whatever is already taken.
        """
        w = self.pool_w[key]
        if not len(w):
            return np.zeros(0)
        value = w @ self.uncovered[key]                       # raw coverage gain

        rows = self.pool_rows[key]
        if self._sim is not None and self.chosen[key]:
            value = value * (1.0 - np.clip(self.cell_closest[key], 0.0, 1.0)
                             ** self.sel.similarity_exponent)

        if self.kinds[key]:
            repeats = np.isin(self.pool_kind[key], list(self.kinds[key]))
            value = np.where(repeats, value * self.sel.genre_repeat_penalty, value)

        if self.sel.collection_weight and self._shelf_cols and self._sim is not None:
            sims = self._shelf_sims[rows][:, :len(self._shelf_cols)]
            # A game is not a duplicate of itself: the repair pass rescores
            # games that are already placed.
            shelf_ids = np.array(self._shelf_cols)
            mine = np.isin(self.pool_ids[key], shelf_ids)
            if mine.any():
                sims = np.where(self.pool_ids[key][:, None] == shelf_ids[None, :],
                                -np.inf, sims)
            closest = sims.max(axis=1)
            fresh = 1.0 - np.clip(closest, 0.0, 1.0) ** self.sel.similarity_exponent
            fresh = np.minimum(fresh, self._redone_all(key, rows))
            value = value * np.clip(fresh, 0.0, None) ** self.sel.collection_weight
        return value

    def _redone_all(self, key, rows) -> np.ndarray:
        """`1 - redone**n` per candidate. Only games with a lineage can score."""
        out = np.ones(len(rows))
        if not self.shelved:
            return out
        # Carrying a reimplementation link is common; having a *shelved*
        # relative is rare. Testing the intersection first skips almost every
        # candidate — without it this loop was a third of the whole allocation.
        shelf = set(self.shelved)
        for i, gid in enumerate(self.pool_ids[key]):
            kin = self.kin.get(gid)
            if not kin or not (kin & shelf):
                continue
            others = [g for g in self.shelved if g != gid]
            if others:
                out[i] = 1.0 - self._redone(gid, others) ** self.sel.similarity_exponent
        return out

    def _redone(self, gid: int, shelved: list[int]) -> float:
        """How much of this game the shelf already holds, as a redoing of it.

        Tag similarity misses this: `7 Wonders Duel` and `The Lord of the Rings:
        Duel for Middle-earth` score 0.583, barely above two unrelated games,
        because each carries tags the other lacks. BGG states plainly that one
        reimplements the other, and `Game.reimplements` now carries that.

        But a lineage is only redundant if it *stayed put*. A reimplementation
        that moves a game to a different player count, or a different weight, is
        a new thing worth shelving beside its parent; one that changes neither
        is the same game again. That is what the grid already measures, so the
        answer is how much two games' cell memberships overlap.

        Nothing here names an axis — it reads what `buckets.build_cells` handed
        us, so the test follows whatever the grid is sorting on. Under players x
        weight, `7 Wonders` and `7 Wonders Duel` score 0.00 and both belong;
        under a playtime axis they score 1.00 and one of them is redundant,
        which is right, because at 30 minutes each they *are* the same offer.
        And the player axis dominates the weight axis for free: a moved player
        count zeroes the overlap where a moved weight only halves it, because
        the columns are discrete and the rows overlap.

        With no axes at all — the collection builder's single cell — every game
        overlaps everything at 1.0, so this collapses to the lineage link alone.
        Which is correct: with no grid to move within, a redoing is a duplicate.
        """
        kin = self.kin.get(gid)
        if not kin:
            return 0.0
        worst = 0.0
        for other in shelved:
            if other not in kin:
                continue
            pair = (gid, other) if gid < other else (other, gid)
            if pair not in self._ground:
                self._ground[pair] = self._overlap(gid, other)
            worst = max(worst, self._ground[pair])
        return worst

    def _overlap(self, a: int, b: int) -> float:
        """Cosine between two games' cell-membership vectors."""
        here, there = self.reach.get(a, {}), self.reach.get(b, {})
        shared = set(here) | set(there)
        if not shared:
            return 0.0
        x = np.array([here.get(k, 0.0) for k in shared])
        y = np.array([there.get(k, 0.0) for k in shared])
        scale = np.linalg.norm(x) * np.linalg.norm(y)
        if not scale:
            return 0.0
        # Clamped for the same reason as `coverage.novelty`: a cosine that comes
        # back at 1 + 4e-16 turns `1 - overlap ** n` negative, and a negative
        # raised to a fractional power is complex in Python.
        return min(max(float(x @ y / scale), 0.0), 1.0)

    def take(self, key, game):
        self.uncovered[key] *= 1.0 - self.weights[(key, game.id)]
        self.chosen[key].append(game.id)
        self.kinds[key].add(self.primary[game.id])
        self.shelved.append(game.id)
        column = self._shelf_add(game.id)
        if column is not None:
            # The same column answers "how close is this candidate to anything
            # this cell already holds", so the per-cell maximum comes free.
            np.maximum(self.cell_closest[key], column[self.pool_rows[key]],
                       out=self.cell_closest[key])

    def _shelf_add(self, gid: int):
        """One more column: this game's similarity to every game in the corpus."""
        if self._sim is None or gid not in self._row_of:
            return None
        column = self._sim @ self._sim[self._row_of[gid]]
        if self._shelf_sims is None:
            self._shelf_sims = np.empty((len(self._ids), 0))
        n = len(self._shelf_cols)
        if self._shelf_sims.shape[1] <= n:      # grow in blocks, not per append
            extra = max(16, self._shelf_sims.shape[1])
            self._shelf_sims = np.hstack(
                [self._shelf_sims, np.zeros((len(self._ids), extra))])
        self._shelf_sims[:, n] = column
        self._shelf_cols.append(gid)
        return column

    def _shelf_compact(self) -> None:
        """Drop the columns of games no longer shelved.

        A column is one game's similarity to the whole corpus, so it does not
        need recomputing when *other* games leave — compacting is a copy, where
        rebuilding would be O(shelf x games x 978) every time a cell is replayed.
        `improve_collection` replays a cell per re-recording it examines, which
        made the difference between a fast allocation and a slow one.
        """
        if self._shelf_sims is None:
            return
        remaining = list(self.shelved)
        keep = []
        for i, gid in enumerate(self._shelf_cols):
            if gid in remaining:
                remaining.remove(gid)     # by count: a cell may be replayed
                keep.append(i)
        self._shelf_sims = self._shelf_sims[:, keep].copy()
        self._shelf_cols = [self._shelf_cols[i] for i in keep]

    def reset_cell(self, key):
        self.uncovered[key] = self.axis_room.copy()
        for gid in self.chosen[key]:
            if gid in self.shelved:
                self.shelved.remove(gid)
        self.chosen[key] = []
        self.kinds[key] = set()
        self.cell_closest[key][:] = 0.0
        self._shelf_compact()

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

    def __init__(self, vectors: dict, baseline: Baseline = DEFAULTS.baseline):
        self.vectors = vectors
        self.baseline = baseline

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
        lam = self.baseline.mmr_lambda
        return (lam * self.quality[(key, game.id)]
                + (1 - lam) * nearest / self.scale[key])

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

def _rerecordings(chosen: dict, overlap=None) -> dict[int, float]:
    """Placed games the shelf already has, and how strongly, in 0..1.

    Two games in a family are not the same game. `Wingspan Asia` brings
    `Economic` and `Push Your Luck`, `Codenames: Duet` brings `Cooperative
    Game`, `Dune: Imperium – Uprising` brings three tags Dune: Imperium has not;
    those are different games and keep their slots when they are best in them.

    What marks a *re-recording* is containment: every tag on one entry is
    already on the other, so nothing distinguishes them to any part of this
    pipeline. `7 Wonders (Second Edition)` carries eleven tags and every one is
    on `7 Wonders`. The impoverished side is the one to reconsider, since it is
    the less informative record of the same game.

    Only games sharing a BGG `Game:` family are compared, so two unrelated games
    that happen to be sparsely tagged are not mistaken for each other.

    A caveat worth knowing: `Splendor` and `Splendor Duel` are genuinely
    different games that BGG has tagged identically. Nothing here can tell them
    apart, so they read as one game — the honest consequence of the data.

    The second source is BGG's own `boardgameimplementation` link, which states
    what containment can only infer. It is what catches `7 Wonders Duel` and
    `The Lord of the Rings: Duel for Middle-earth`: each carries tags the other
    lacks, so containment calls them different games and their tag similarity is
    0.583, barely above two unrelated titles — but BGG says plainly that one
    redoes the other. Strength there is `overlap`, how much of the grid the two
    still share, so a redoing that moved somewhere new is barely flagged and one
    that moved nowhere is flagged outright.
    """
    placed = [g for games in chosen.values() for g in games]
    redundant: dict[int, float] = {}

    def flag(gid, strength):
        redundant[gid] = max(redundant.get(gid, 0.0), strength)

    for i, a in enumerate(placed):
        for b in placed[i + 1:]:
            # BGG saying outright that one redoes the other, weighted by how
            # much of the grid they still share. A redoing that moved to another
            # player count or weight is a new game; one that moved nowhere is
            # the same game twice. `overlap` reads cell memberships, so what
            # counts as "moved" follows whatever axes the grid was built on.
            if overlap is not None and (b.id in a.reimplements or a.id in b.reimplements):
                flag(b.id if b.rank > a.rank else a.id, overlap(a.id, b.id))
            if not set(a.families) & set(b.families):
                continue
            sa, sb = set(a.signals), set(b.signals)
            if sa <= sb and len(sa) <= len(sb):
                flag(a.id if sa < sb or a.rank > b.rank else b.id, 1.0)
            elif sb <= sa:
                flag(b.id, 1.0)
    return redundant


def improve_collection(keys, cells, scorer, chosen, gains, taken, keep,
                       pinned: frozenset = frozenset()) -> list[tuple]:
    """Swap out re-recordings the collection gains nothing from holding twice.

    Only ever a swap, never a removal: a cell that has nothing to put in the
    slot keeps what it has. That is the whole difference from blocking a game
    outright, which drops it whether or not the cell can cover the gap.

    `keep` is how much of the slot's value the replacement must retain, as a
    fraction rather than a fixed margin — cell gains span 0.03 to 0.94, so a
    flat tolerance would be meaningless at one end and ruinous at the other.

    Returns the swaps it made, which is also the shape a "what to cut, what to
    add" report wants.

    `pinned` is games the caller placed rather than the allocator winning — an
    imported collection. They are never swapped out, however redundant, because
    the reader owns them: a shelf holding both `7 Wonders` and
    `7 Wonders (Second Edition)` is a fact about that shelf, not a mistake for
    this pass to correct. Reporting the redundancy is useful; deleting someone's
    game from their own grid and substituting a recommendation is not.
    """
    # Lineage needs the cell-membership overlap, which only a scorer that keeps
    # per-cell state can answer. Without it this falls back to containment
    # alone, which is what the simpler scorers get.
    overlap = getattr(scorer, "_overlap", None)
    redone = getattr(scorer, "_redone", lambda gid, shelved: 0.0)

    swapped = []
    for gid, strength in _rerecordings(chosen, overlap).items():
        if strength <= 0.0:
            continue        # a redoing that went somewhere new is not redundant
        if gid in pinned:
            continue        # the reader owns it; not ours to replace
        key = next((k for k in keys if any(g.id == gid for g in chosen[k])), None)
        if key is None:
            continue
        game = next(g for g in chosen[key] if g.id == gid)
        here = scorer.score(key, game)
        rest = [g for g in chosen[key] if g.id != gid]
        scorer.reset_cell(key)
        for other in rest:
            scorer.take(key, other)
        # The replacement must be less redundant than what it replaces, or the
        # swap achieves nothing — without this, `7 Wonders` was replaced by
        # `7 Wonders (Second Edition)`, which is the case this whole pass exists
        # to prevent.
        elsewhere = [g.id for k in keys for g in chosen[k] if g.id != gid]
        # The cell's state is fixed for the whole search, so score it once.
        values = (scorer.score_all(key) if hasattr(scorer, "score_all")
                  else np.array([scorer.score(key, c) for c in cells[key]]))
        best, best_score = None, 0.0
        for i, candidate in enumerate(cells[key]):
            if candidate.id in taken:
                continue
            if redone(candidate.id, elsewhere) >= strength:
                continue
            value = float(values[i])
            if value > best_score:
                best, best_score = candidate, value
        # How good the replacement must be, sliding with how redundant the game
        # is. A game the shelf fully duplicates is worth replacing at `keep` of
        # its slot; one that barely overlaps has to be replaced by something
        # outright better. No threshold to pick — the strength is the dial.
        bar = keep + (1.0 - keep) * (1.0 - strength)
        if best is not None and best_score >= bar * here:
            chosen[key] = rest + [best]
            gains.pop((key, gid), None)
            gains[(key, best.id)] = best_score
            taken.discard(gid)
            taken.add(best.id)
            scorer.take(key, best)
            swapped.append((key, game, best))
        else:
            chosen[key] = rest + [game]
            scorer.take(key, game)
    return swapped


def _capacity_lookup(capacity) -> Callable[[tuple], int]:
    """Normalise a capacity given as a number, a mapping or a callable."""
    if callable(capacity):
        return capacity
    if isinstance(capacity, dict):
        return lambda key: capacity.get(key, 0)
    return lambda key: capacity


#: Decimal places a shelved game's gain is reported to.
#:
#: It looks like display precision and is not: `depth.read_depth` reads these
#: numbers to decide where a shelf stops, so both engines must round identically
#: or they disagree about which fall was sharpest. Measured: at full precision
#: the weight-3 row with genre 9 discounted cuts at 10, and at three places two
#: drops tie at 0.120 and it cuts at 8. The contract carries this so the browser
#: rounds the same way; ties keep the earlier index on both sides.
GAIN_PLACES = 3


def allocate(cells: dict, memberships: dict, scorer: Scorer,
             capacity: int | dict | Callable[[tuple], int],
             seeded: dict | None = None, alternates_limit: int = 0,
             sel: Selection = DEFAULTS.selection,
             gain_floor: float | None = None,
             rejected: set[int] | None = None) -> dict:
    """Fill every cell, placing each game at most once across all of them.

    `cells` maps key -> [Game] and `memberships` maps (key, game id) -> degree,
    both from `buckets.build_cells`. `seeded` pre-places games in a cell without
    them competing for a slot — the collection builder's anchors.

    `capacity` is how many games a cell may hold: one number for the whole grid,
    or a lookup when cells differ. It is per cell rather than global so an
    imported collection can put six games in one cell and two in another without
    the allocator caring.

    `rejected` is games the reader has banned — never shelved, and never offered
    as an alternate either, since a runner-up you have already turned down is not
    a suggestion. Selection re-runs in full rather than patching the one slot,
    which is simpler and more correct: a game is placed at most once across the
    grid, so removing one can free others it was crowding out.

    `gain_floor` is how *little* a game may add and still be shelved. It stops a
    cell short of capacity, so at 0 a cell always fills while candidates remain
    — which is the point of "maximise the cell". Note what it really excludes is
    games that barely reach the cell at all: gain is membership x quality x
    loading against the still-uncovered chart, and Poker scores 0.03 in the
    nine-plus Medium-Heavy cell because its *membership there is 0.11*, not
    because it is a poor game.

    Rounds, not one long greedy: every cell bids, a contested game goes to
    whichever cell scores it highest, losers re-bid, and nothing commits until
    the round ends. Bidding and repair alternate until a whole pass changes
    nothing, because `_repair` moves a game to a cell that wants it more and can
    leave the cell it came from a slot short — that is how one cell finished
    with four picks while `A Gentle Rain` sat unclaimed and scoring 0.32.

    Filling is the primary goal, so a cell keeps taking its best remaining
    candidate until it reaches capacity or runs out. Whether the collection as a
    whole would rather it took something else is a separate, secondary question,
    settled afterwards by `improve_collection`.
    """
    gain_floor = sel.gain_floor if gain_floor is None else gain_floor
    keys = sorted(cells)                 # deterministic: contests must not
    scorer.begin(cells, memberships)     # hinge on dict iteration order
    room = _capacity_lookup(capacity)

    chosen = {key: [] for key in keys}
    gains: dict[tuple, float] = {}
    # Rejected games start out already claimed, so nothing can bid for them
    # and the leftovers pass will not offer them as alternates either.
    taken: set[int] = set(rejected or ())

    for key, games in (seeded or {}).items():
        for game in games:
            if game.id in taken:      # owned *and* rejected: rejection wins,
                continue              # which is how "I want rid of this" reads
            scorer.take(key, game)
            chosen[key].append(game)
            taken.add(game.id)

    # Bid until nothing more clears the floor, repair, then bid again in case
    # repair emptied a slot. Bounded by the number of slots, since every pass
    # that continues has filled at least one.
    for _ in range(sum(room(k) for k in keys) + len(keys)):
        awards = _bid_round(keys, cells, memberships, scorer, chosen, taken,
                            room, gain_floor)
        if not awards:
            _repair(keys, memberships, scorer, chosen, gains, room, seeded or {})
            awards = _bid_round(keys, cells, memberships, scorer, chosen, taken,
                                room, gain_floor)
            if not awards:
                break
        # A round commits together, so apply best bid first and skip anything
        # already claimed — two cells can be awarded the same game only if the
        # round handed it out twice, which the guard below makes harmless.
        for key, (game, gain) in sorted(awards.items(), key=lambda kv: -kv[1][1]):
            if game.id in taken:
                continue
            taken.add(game.id)
            gains[(key, game.id)] = gain
            scorer.take(key, game)
            chosen[key].append(game)

    # Cells are as full as they can be; now let the collection have its say.
    improve_collection(keys, cells, scorer, chosen, gains, taken,
                       sel.replacement_keep,
                       pinned=frozenset(g.id for games in (seeded or {}).values()
                                        for g in games))

    results = {}
    for key in keys:
        picked = {g.id for g in chosen[key]}
        leftovers = sorted(
            (g for g in cells[key] if g.id not in picked and g.id not in taken),
            key=lambda g: g.rank,
        )
        results[key] = CellResult(
            [Assignment(g, round(gains[(key, g.id)], GAIN_PLACES)
                        if (key, g.id) in gains else None)
             for g in chosen[key]],
            leftovers[:alternates_limit],
        )
    return results


def _bid_round(keys, cells, memberships, scorer, chosen, taken, room,
               gain_floor) -> dict:
    """One round of deferred acceptance; returns {cell key: (Game, score)}."""
    held: dict[int, tuple] = {}          # game id -> (cell key, score, Game)
    blocked: dict[tuple, set[int]] = {key: set() for key in keys}
    pending = [k for k in keys if len(chosen[k]) < room(k)]

    batched = hasattr(scorer, "score_all")

    while pending:
        key = pending.pop(0)
        best, best_score = None, 0.0
        if batched:
            # Membership breaks ties, so a game is never claimed by a cell it
            # barely reaches while one centred on it wants the same game.
            # `lexsort` orders by its *last* key first, so this is (value, then
            # membership) — the same comparison the tuple below makes.
            pool, values = cells[key], scorer.score_all(key)
            ids = scorer.pool_ids[key]
            live = values >= gain_floor
            if taken:
                live &= ~np.isin(ids, list(taken))
            if blocked[key]:
                live &= ~np.isin(ids, list(blocked[key]))
            where = np.flatnonzero(live)
            if len(where):
                pick = where[np.lexsort((scorer.pool_memb[key][where], values[where]))[-1]]
                best, best_score = pool[pick], float(values[pick])
        else:
            best_sort = None
            for game in cells[key]:
                if game.id in taken or game.id in blocked[key]:
                    continue
                value = scorer.score(key, game)
                if value < gain_floor:
                    continue
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


def _repair(keys, memberships, scorer, chosen, gains, room, seeded) -> None:
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
                    if other == key or len(chosen[other]) >= room(other):
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
