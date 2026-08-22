"""How deep a shelf goes, read from its own curve rather than chosen.

A shelf fills in order of what each game still adds, and that sequence falls away
as the ground gets covered. Where it falls off a cliff, that is where the shelf
wants to stop. Where it merely slopes there is nothing to find, and the number a
reader set applies instead — the interface says which of the two happened.

Read once per axis, never per cell. Measured on the seed corpus: thirty-five
five-pick sequences give a median depth of 1 with one cell at 19, which is noise.
Read down the seven player columns instead and the answers are 5, 6, 11, 10, 3
and — at nine-plus — 1, because after the best game there the next is worth a
quarter as much.

`web/src/engine/depth.js` is the same rule, and the parity harness checks that
they agree.
"""

from . import buckets, coverage
from .assign import GAIN_PLACES, CoverageScorer, allocate

#: Deep enough that the curve has somewhere to fall. Never a cap on the answer.
PROBE = 40


def read_depth(gains, leftover: float, fallback: int) -> dict:
    """The cut in one gain sequence.

    `leftover` is the whole rule: the sharpest fall only counts as a stopping
    point when what the next game would still have added is under this share of
    what the first one added. Without it the rule fires on smooth curves and
    leaves real value behind — players 4 stops at 3 with 0.74 still on the table.
    """
    # Read at the precision both engines publish, never at whatever this one
    # happens to hold — see GAIN_PLACES.
    g = [round(v, GAIN_PLACES) for v in gains if v is not None]
    if len(g) < 4:
        return {"depth": len(g), "auto": True, "left": 0.0}

    widest, at = float("-inf"), 1
    for i in range(1, len(g)):
        drop = g[i - 1] - g[i]
        if drop > widest:
            widest, at = drop, i

    left = g[at] / g[0] if g[0] > 0 else 1.0
    if left <= leftover:
        return {"depth": at, "auto": True, "left": left}
    return {"depth": fallback, "auto": False, "left": left}


def axis_depths(games, space, ratings, sel, axis, leftover, fallback,
                probe: int = PROBE, axis_room=None) -> dict:
    """Read every bucket of one axis at once.

    Runs the allocation with that axis alone and a generous ceiling, which is the
    only way to see the curve: a shelf capped at five never shows what its sixth
    pick would have been worth.
    """
    cells, memberships = buckets.build_cells(games, [axis], sel)
    scorer = CoverageScorer(space.loadings, space.similarity, ratings,
                            space.spoke_of, sel, axis_room)
    results = allocate(cells, memberships, scorer, probe, alternates_limit=0, sel=sel)
    return {key[0]: {**read_depth([a.gain for a in r.assignments], leftover, fallback),
                     "key": key[0]}
            for key, r in results.items()}


def grid_depths(games, space, ratings, sel, coll, weight_rows,
                overrides: dict | None = None, probe: int = PROBE,
                axis_room=None, column_axis=None, row_axis=None) -> dict:
    """Depth for every cell, as `allocate` wants it.

    A cell takes the smaller of its column's answer and its row's, because both
    are ceilings — the same rule `Collection.capacity()` applies to a reader's
    per-column and per-row caps.
    """
    overrides = overrides or {}
    leftover, fallback = coll.auto_depth_leftover, coll.picks_per_cell
    # The axes are passed in rather than built here so a caller measuring against
    # the contract can hand over the quantised ones it is already using — reading
    # the curve off differently-rounded memberships would put the two engines out
    # of step before selection even began.
    common = (games, space, ratings, sel)
    column_axis = column_axis or buckets.PlayerCountAxis(coll.columns(), sel)
    row_axis = row_axis or buckets.WeightAxis(weight_rows, sel)
    by_column = axis_depths(*common, column_axis, leftover, fallback, probe, axis_room)
    by_row = axis_depths(*common, row_axis, leftover, fallback, probe, axis_room)

    def resolve(read, key, kind):
        if f"{kind}:{key}" in overrides:
            return {"depth": overrides[f"{kind}:{key}"], "auto": False,
                    "read": read.get(key, {}).get("depth")}
        seen = read.get(key)
        return {"depth": seen["depth"] if seen else fallback,
                "auto": bool(seen and seen["auto"]),
                "read": seen["depth"] if seen else None}

    columns = {c["label"]: resolve(by_column, c["label"], "column")
               for c in coll.columns()}
    rows = {str(r["index"]): resolve(by_row, str(r["index"]), "row")
            for r in weight_rows}
    capacity = {(label, index): min(c["depth"], r["depth"])
                for label, c in columns.items() for index, r in rows.items()}
    return {"capacity": capacity, "columns": columns, "rows": rows}
