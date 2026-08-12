"""Placing games onto the two axes.

Columns (player count) come straight from config ranges. Rows (weight) are
*mined from the data*: we cut the population into equal-sized quantile buckets
so each row holds a comparable number of games, instead of guessing cut points
that leave the "heavy" row nearly empty.
"""

from .config import PLAYER_COLUMNS, WEIGHT_ROW_LADDER
from .model import Game


# --- Columns: player count --------------------------------------------------

def player_column_for(game: Game) -> str | None:
    """The single player-count column this game lives in.

    Each game gets exactly one home: the column containing its peak player
    count (the count the community most often rates "Best"). Returns None if we
    have no player-count signal for the game.
    """
    peak = game.best_count
    if not peak:
        return None
    for col in PLAYER_COLUMNS:
        lo, hi = col["lo"], col["hi"]
        if lo <= peak and (hi is None or peak <= hi):
            return col["label"]
    return None


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


def _row_name(index: int, row_count: int) -> str:
    """Relative complexity label for a row, lightest (0) to heaviest."""
    if row_count <= len(WEIGHT_ROW_LADDER):
        return WEIGHT_ROW_LADDER[index]
    return f"Tier {index + 1}"
