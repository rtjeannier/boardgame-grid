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
    """Where one shelf stops.

    It keeps taking games while the next still adds at least `leftover` of what
    the first one added, and stops at the first that does not. That is the whole
    rule, and it is deliberately not "cut at the sharpest fall": the sharpest
    fall is a single argmax over the sequence, so removing one game can move it
    anywhere. Blocking Dune: Imperium swung a column from eleven to five,
    because the largest drop relocated and the old rule then declined to use it
    at all.

    A threshold on the level is monotone instead — ban a game and the crossing
    point shifts by a place or two, never across the shelf. It also never
    declines, so there is no second rule to explain.
    """
    # Read at the precision both engines publish, never at whatever this one
    # happens to hold - see GAIN_PLACES.
    g = [round(v, GAIN_PLACES) for v in gains if v is not None]
    if not g:
        return {"depth": 0, "auto": True, "bar": 0.0, "next": None}

    bar = round(leftover * g[0], GAIN_PLACES)
    depth = 0
    while depth < len(g) and g[depth] > bar:
        depth += 1
    depth = depth or min(1, len(g))
    return {"depth": depth, "auto": True, "bar": bar,
            "next": g[depth] if depth < len(g) else None, "fallback": fallback}

def axis_depths(games, space, ratings, sel, axis, leftover, fallback,
                probe: int = PROBE, axis_room=None, rejected=()) -> dict:
    """Read every bucket of one axis at once.

    Runs the allocation with that axis alone and a generous ceiling, which is the
    only way to see the curve: a shelf capped at five never shows what its sixth
    pick would have been worth.

    Bans move the curve; pins do not. A banned game is genuinely not available,
    so the shelf below it really does fill differently. A pinned game is still
    one of the candidates — pinning only says it must be among them. Seeding it
    into the probe makes it contribute its coverage first, which flattens every
    gain after it and drags the knee an entry earlier: pin any game at all and
    the collection quietly shrank from twelve to eleven. That was an artefact of
    the measurement, not a finding about the collection.
    """
    cells, memberships = buckets.build_cells(games, [axis], sel)
    scorer = CoverageScorer(space.loadings, space.similarity, ratings,
                            space.spoke_of, sel, axis_room)
    results = allocate(cells, memberships, scorer, probe, alternates_limit=0, sel=sel,
                       rejected=set(rejected))
    return {key[0]: {**read_depth([a.gain for a in r.assignments], leftover, fallback),
                     "key": key[0]}
            for key, r in results.items()}


def grid_depths(games, space, ratings, sel, coll, weight_rows,
                overrides: dict | None = None, probe: int = PROBE,
                axis_room=None, column_axis=None, row_axis=None,
                rejected=()) -> dict:
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
    by_column = axis_depths(*common, column_axis, leftover, fallback, probe,
                            axis_room, rejected)
    by_row = axis_depths(*common, row_axis, leftover, fallback, probe,
                         axis_room, rejected)

    def resolve(read, key, kind):
        seen = read.get(key)
        if f"{kind}:{key}" in overrides:
            return {"depth": overrides[f"{kind}:{key}"], "auto": False, "set": True,
                    "read": seen["depth"] if seen else None,
                    "bar": seen["bar"] if seen else None}
        return {"depth": seen["depth"] if seen else fallback,
                "auto": bool(seen and seen["auto"]), "set": False,
                "read": seen["depth"] if seen else None,
                "bar": seen["bar"] if seen else None}

    columns = {c["label"]: resolve(by_column, c["label"], "column")
               for c in coll.columns()}
    rows = {str(r["index"]): resolve(by_row, str(r["index"]), "row")
            for r in weight_rows}
    # A shelf takes the smaller of its column's answer and its row's, unless the
    # reader has said otherwise about that one shelf. Per-cell beats both,
    # because it is the most specific thing anybody said.
    capacity = {}
    for label, c in columns.items():
        for index, r in rows.items():
            key = (label, index)
            set_here = overrides.get(f"cell:{label}|{index}")
            capacity[key] = (min(c["depth"], r["depth"]) if set_here is None
                             else max(0, set_here))
    return {"capacity": capacity, "columns": columns, "rows": rows}
