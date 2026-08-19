"""Placing games onto the two axes.

Columns (player count) come straight from config ranges. Rows (weight) are
*mined from the data*: we cut the population into equal-sized quantile buckets
so each row holds a comparable number of games, instead of guessing cut points
that leave the "heavy" row nearly empty.

Placement is *by degree*, not exclusive. Both axes are fuzzy at the edges: the
player-count poll is a distribution, and a weight of 2.89 is not meaningfully
different from 2.91 just because a quantile cut fell between them. So a game
returns a membership per column and per row, and the two multiply into a
membership per cell. `build.py` uses that to scale coverage contribution, so a
game centred in a cell counts fully and one that merely reaches it counts less.
"""

from collections import defaultdict
from collections.abc import Sequence
from typing import Protocol

from .config import (
    CELL_MEMBERSHIP_FLOOR,
    MEMBERSHIP_FLOOR,
    PLAYER_COLUMNS,
    RECOMMENDED_WEIGHT,
    WEIGHT_ROW_LADDER,
    WEIGHT_TAPER,
)
from .model import Game


# --- Columns: player count --------------------------------------------------

def _column_of(count: int) -> str | None:
    for col in PLAYER_COLUMNS:
        lo, hi = col["lo"], col["hi"]
        if lo <= count and (hi is None or count <= hi):
            return col["label"]
    return None


def player_column_for(game: Game) -> str | None:
    """The single column containing this game's peak player count.

    Still used for the `--assigner mmr` / `greedy` paths, which assign one home
    per game. The coverage assigner uses `player_memberships` instead.
    """
    peak = game.best_count
    return _column_of(peak) if peak else None


def player_memberships(game: Game) -> dict[str, float]:
    """How strongly this game belongs to each player-count column, in (0, 1].

    A count's score is its *approval share*, `(best + w·recommended) / votes`,
    among counts the community does not reject outright. Not its share of Best
    votes: Best alone is a preference ordering, and a vote for four players is a
    vote taken away from five. Cartographers' five-player row reads 108 Best /
    156 Recommended / 23 Not Recommended — 92% approval against 97% at four —
    yet scored 108/248 = 0.44 and looked like a barely-five-player game.
    `RECOMMENDED_WEIGHT` sets how much a "this works" vote counts against a
    "this is the best" one.

    All three vote types matter, and they are not interchangeable. Recommended
    is a weak yes, so it is discounted rather than counted in full — treated as
    equal to Best it says Concordia is as much a three-player game as a four
    (255 Best against 451), and that El Grande, whose whole identity is being
    best at five, is equally a four-player game. Not Recommended is a real no,
    so it both dilutes the share and vetoes the count outright when it carries a
    majority.

    Then scored *peak-relative*: every column is divided by the strongest, so
    the game's home column is 1.0. A game the community likes equally at 3, 4,
    5 and 6 therefore scores 1.0 in all four — versatility is not punished.
    (Dividing by the total instead would give it 0.25 apiece and rank it below a
    mediocre game playable only at 4.)

    Empty when no count clears the floor — such a game has no place on the
    player axis and is simply not placed.
    """
    by_column: dict[str, float] = {}
    for count, (best, recommended, not_rec) in game.player_poll.items():
        col = _column_of(count)
        total = best + recommended + not_rec
        if col is None or total == 0:
            continue
        # Never place a game at a count most voters reject. Not Recommended is
        # otherwise only a denominator, and a count can score its way in on
        # sheer turnout: Cartographers at nine-plus reads 17 Best / 78
        # Recommended / 104 Not, and The Crew at two reads 27 / 243 / 356 —
        # both majority-negative, both eligible on approval share alone. They
        # were previously excluded only by accident, in that at
        # RECOMMENDED_WEIGHT 0.25 they happened to land under MEMBERSHIP_FLOOR.
        if not_rec > best + recommended:
            continue
        score = (best + RECOMMENDED_WEIGHT * recommended) / total
        # A column spans several counts (6-8); take its strongest, not the sum,
        # or wide columns would look better merely for being wide.
        by_column[col] = max(by_column.get(col, 0.0), score)
    if not by_column:
        return {}

    peak = max(by_column.values())
    if peak <= 0:
        return {}
    return {
        col: score / peak
        for col, score in by_column.items()
        if score / peak >= MEMBERSHIP_FLOOR
    }


# --- Rows: weight quantiles -------------------------------------------------

def weight_row_edges(weights: list[float], row_count: int) -> list[float]:
    """Interior cut points that split `weights` into `row_count` equal parts.

    Returns row_count-1 edges. E.g. row_count=5 -> the 20/40/60/80th
    percentiles. Rows are then [min, e0), [e0, e1), ... [e_last, max].
    """
    ordered = sorted(weights)
    n = len(ordered)
    edges = []
    for k in range(1, row_count):
        # Nearest-rank percentile — simple and dependency-free.
        idx = min(n - 1, round(k / row_count * n))
        edges.append(round(ordered[idx], 2))
    return edges


def build_weight_rows(weights: list[float], row_count: int) -> list[dict]:
    """Row descriptors (index, numeric range, cosmetic name), lightest first."""
    edges = weight_row_edges(weights, row_count)
    lo_bounds = [min(weights)] + edges
    hi_bounds = edges + [max(weights)]
    rows = []
    for i, (lo, hi) in enumerate(zip(lo_bounds, hi_bounds)):
        rows.append({
            "index": i,
            "lo": round(lo, 2),
            "hi": round(hi, 2),
            "name": _row_name(i, row_count),
        })
    return rows


def weight_row_index(weight: float, rows: list[dict]) -> int:
    """The row a given weight falls into (last row is inclusive at the top)."""
    for row in rows:
        if weight <= row["hi"]:
            return row["index"]
    return rows[-1]["index"]


def weight_memberships(weight: float, rows: list[dict]) -> dict[int, float]:
    """How strongly a weight belongs to each row, in (0, 1].

    Full membership inside a row, tapering linearly to zero across WEIGHT_TAPER
    units past each edge — so a game at 2.87 partly belongs to the row starting
    at 2.90. The edges are quantile cuts, not real category boundaries, and BGG
    publishes only a mean weight with no distribution behind it, so a hard cut
    asserts a precision the data doesn't have.
    """
    memberships: dict[int, float] = {}
    for row in rows:
        lo, hi = row["lo"], row["hi"]
        if lo <= weight <= hi:
            memberships[row["index"]] = 1.0
        elif weight < lo and lo - weight < WEIGHT_TAPER:
            memberships[row["index"]] = 1.0 - (lo - weight) / WEIGHT_TAPER
        elif weight > hi and weight - hi < WEIGHT_TAPER:
            memberships[row["index"]] = 1.0 - (weight - hi) / WEIGHT_TAPER
    return memberships


# --- Axes: an arbitrary stratification of the game space ---------------------
#
# The grid's two axes aren't special. An axis is anything that answers "how
# strongly does this game belong to each of my buckets", so a genre axis or a
# mechanic axis would slot in beside these without the allocator noticing. The
# *unstratified* case — no axes at all, one bucket holding everything — is what
# the collection builder uses, which is why it and the grid share one code path.


class Axis(Protocol):
    """One dimension of the space, cut into named buckets."""

    name: str

    def memberships(self, game: Game) -> dict[str, float]:
        """Bucket label -> how strongly `game` belongs to it, in (0, 1]."""
        ...


class PlayerCountAxis:
    """Columns: the player counts the community endorses, peak-relative."""

    name = "players"

    def memberships(self, game: Game) -> dict[str, float]:
        return player_memberships(game)


class WeightAxis:
    """Rows: quantile weight bands with tapered edges.

    Built from the population rather than fixed cut points, so it needs the rows
    handed to it — see `build_weight_rows`.
    """

    name = "weight"

    def __init__(self, rows: list[dict]):
        self.rows = rows

    def memberships(self, game: Game) -> dict[str, float]:
        return {str(i): m for i, m in weight_memberships(game.weight, self.rows).items()}


def build_cells(games: list[Game], axes: Sequence[Axis]) -> tuple[dict, dict]:
    """Cross the axes into cells and place every game in each by degree.

    Returns `(cells, memberships)` where `cells` maps a key — a tuple of one
    bucket label per axis — to the games that reach it, and `memberships` maps
    `(key, game id)` to the product of the game's membership on each axis.

    With `axes=[]` there is exactly one cell, keyed `()`, holding every game at
    membership 1.0. That is the whole game space, unstratified — the collection
    builder's view — so it needs no separate implementation.
    """
    cells: dict[tuple, list[Game]] = defaultdict(list)
    memberships: dict[tuple, float] = {}

    for game in games:
        placements: list[tuple[tuple, float]] = [((), 1.0)]
        for axis in axes:
            nxt = []
            for label, axis_m in axis.memberships(game).items():
                for key, m in placements:
                    nxt.append((key + (label,), m * axis_m))
            placements = nxt
        for key, m in placements:
            if m > CELL_MEMBERSHIP_FLOOR:
                cells[key].append(game)
                memberships[(key, game.id)] = m

    return dict(cells), memberships


def _row_name(index: int, row_count: int) -> str:
    """Relative complexity label for a row, lightest (0) to heaviest."""
    if row_count <= len(WEIGHT_ROW_LADDER):
        return WEIGHT_ROW_LADDER[index]
    return f"Tier {index + 1}"
