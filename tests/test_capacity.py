"""Depth need not be uniform across the grid.

The player columns are fixed ranges over a lopsided distribution: `8+` holds 142
candidates against 5,577 for `4`, and its median pick gain is 0.174 against
0.660. Five slots in each mean very different things.

There are two answers and they are for different problems. `gain_floor` is the
data-driven one — it trims whichever cells have nothing left worth shelving,
which turns out to be only `8+` — and these explicit caps are for preference.
"""

from collections import defaultdict

from pipeline import buckets
from pipeline.assign import CoverageScorer, allocate
from pipeline.params import DEFAULTS, Params


def _grid(seed_build, capacity, sel=None):
    games, space = seed_build["games"], seed_build["space"]
    sel = sel or DEFAULTS.selection
    coll = DEFAULTS.collection
    rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)
    cells, memb = buckets.build_cells(
        games, [buckets.PlayerCountAxis(coll.columns(), sel),
                buckets.WeightAxis(rows, sel)], sel)
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of, sel)
    cap = capacity(cells) if callable(capacity) else capacity
    return allocate(cells, memb, scorer, cap, sel=sel)


def _per_column(results):
    out = defaultdict(int)
    for key, r in results.items():
        out[key[0]] += len(r.assignments)
    return out


def test_uniform_capacity_returns_the_scalar():
    """No overrides means no map to build — `allocate` takes the number."""
    assert Params().collection.capacity([("4", "0")]) == DEFAULTS.collection.picks_per_cell


def test_capacity_map_covers_every_cell():
    """`_capacity_lookup` reads a dict with `.get(key, 0)`.

    A cell missing from the map would silently get no slots at all, so the map
    has to be complete rather than only naming the overrides.
    """
    keys = [("4", "0"), ("4", "1"), ("8+", "0")]
    cap = Params().replace(collection={"picks_per_column": {"8+": 2}}).collection.capacity(keys)
    assert set(cap) == set(keys)
    assert cap[("4", "0")] == DEFAULTS.collection.picks_per_cell
    assert cap[("8+", "0")] == 2


def test_column_and_row_caps_take_the_smaller():
    """Both are ceilings, so a capped cell obeys the tighter of the two."""
    p = Params().replace(collection={"picks_per_column": {"8+": 2},
                                     "picks_per_row": {"1": 3}})
    cap = p.collection.capacity([("4", "1"), ("8+", "1"), ("4", "0")])
    assert cap[("4", "1")] == 3          # row cap only
    assert cap[("8+", "1")] == 2         # column cap is tighter
    assert cap[("4", "0")] == DEFAULTS.collection.picks_per_cell


def test_a_capped_column_holds_fewer_games(seed_build):
    p = Params().replace(collection={"picks_per_column": {"8+": 2}})
    capped = _per_column(_grid(seed_build, p.collection.capacity))
    base = _per_column(_grid(seed_build, DEFAULTS.collection.picks_per_cell))

    assert capped["8+"] < base["8+"]
    assert capped["8+"] <= 2 * DEFAULTS.collection.weight_rows
    for col in ("2", "3", "4"):
        assert capped[col] == base[col], "capping one column must not disturb another"


def test_gain_floor_trims_only_the_thin_column(seed_build):
    """The data-driven alternative, and why it is preferred for scarcity.

    Nothing names `8+` here — the floor simply declines to shelve games that
    barely reach their cell, and that is where they are.
    """
    base = _per_column(_grid(seed_build, DEFAULTS.collection.picks_per_cell))
    floored = _per_column(_grid(
        seed_build, DEFAULTS.collection.picks_per_cell,
        sel=Params().replace(selection={"gain_floor": 0.2}).selection))

    assert floored["8+"] < base["8+"]
    assert sum(floored.values()) < sum(base.values())
