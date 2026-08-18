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

from .config import (
    CELL_MEMBERSHIP_FLOOR,
    MEMBERSHIP_FLOOR,
    PLAYER_COLUMNS,
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

    Scored *peak-relative*: a column takes its best constituent count's "Best"
    votes, and every column is divided by the strongest one, so the game's home
    column is 1.0. A game the community likes equally at 3, 4, 5 and 6 therefore
    scores 1.0 in all four — versatility is not punished. (Dividing by the total
    instead would give it 0.25 apiece and rank it below a mediocre game playable
    only at 4.)

    Falls back to the peak column alone when raw votes are unavailable, which is
    the case for the committed seed dataset.
    """
    if not game.best_votes:
        home = player_column_for(game)
        return {home: 1.0} if home else {}

    by_column: dict[str, int] = {}
    for count, votes in game.best_votes.items():
        col = _column_of(count)
        if col is not None:
            # A column spans several counts (6-8); take its strongest, not the
            # sum, or wide columns would look better merely for being wide.
            by_column[col] = max(by_column.get(col, 0), votes)
    if not by_column:
        return {}

    peak = max(by_column.values())
    return {
        col: votes / peak
        for col, votes in by_column.items()
        if votes / peak >= MEMBERSHIP_FLOOR
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


def cell_memberships(game: Game, rows: list[dict]) -> dict[tuple[str, int], float]:
    """Every cell this game belongs to, mapped to its membership.

    The product of the two axes' memberships, which is what `build.py` uses to
    scale a game's coverage contribution per cell.
    """
    columns = player_memberships(game)
    weights = weight_memberships(game.weight, rows)
    cells: dict[tuple[str, int], float] = {}
    for col, col_m in columns.items():
        for row, row_m in weights.items():
            if col_m * row_m > CELL_MEMBERSHIP_FLOOR:
                cells[(col, row)] = col_m * row_m
    return cells


def _row_name(index: int, row_count: int) -> str:
    """Relative complexity label for a row, lightest (0) to heaviest."""
    if row_count <= len(WEIGHT_ROW_LADDER):
        return WEIGHT_ROW_LADDER[index]
    return f"Tier {index + 1}"
