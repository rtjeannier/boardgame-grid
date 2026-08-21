"""Games the reader owns are placed by the caller, not won — and stay put.

`allocate(seeded=...)` is how an imported collection lands on the grid. Two
things about seeded games were wrong for that use, and both only bite once a
whole collection is imported rather than the handful of anchors the CLI passes.
"""

import pytest

from pipeline import buckets
from pipeline.assign import CoverageScorer, allocate
from pipeline.params import DEFAULTS

# `Gloomhaven: Jaws of the Lion` carries no tag `Gloomhaven` lacks and shares the
# `Game: Gloomhaven` family, which is exactly what `_rerecordings` calls a
# redoing. Owning both is ordinary — it is a standalone game, not an expansion.
GLOOMHAVEN, JAWS = 174430, 291457


def _cells(seed_build):
    games = seed_build["games"]
    sel, coll = DEFAULTS.selection, DEFAULTS.collection
    rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)
    return buckets.build_cells(
        games, [buckets.PlayerCountAxis(coll.columns(), sel),
                buckets.WeightAxis(rows, sel)], sel)


def _scorer(seed_build):
    space, games = seed_build["space"], seed_build["games"]
    return CoverageScorer(space.loadings, space.similarity,
                          {g.id: g.rating for g in games}, space.spoke_of,
                          DEFAULTS.selection)


def _best_cell(memberships, gid):
    reach = {k: d for (k, i), d in memberships.items() if i == gid}
    return max(reach, key=reach.get)


def test_owned_re_recordings_are_never_swapped_out(seed_build):
    """The bug: `improve_collection` could delete a game the reader owns.

    It received `chosen` but never `seeded`, unlike `_repair` which has always
    taken a pinned set. So a shelf holding both Gloomhaven and Jaws of the Lion
    had one of them silently replaced by a recommendation.
    """
    games = seed_build["games"]
    owned = [g for g in games if g.id in (GLOOMHAVEN, JAWS)]
    assert len(owned) == 2, "precondition: both are in the seed dataset"

    cells, memb = _cells(seed_build)
    seeded = {}
    for g in owned:
        seeded.setdefault(_best_cell(memb, g.id), []).append(g)

    results = allocate(cells, memb, _scorer(seed_build),
                       DEFAULTS.collection.picks_per_cell, seeded=seeded,
                       sel=DEFAULTS.selection)
    shelved = {a.game.id for r in results.values() for a in r.assignments}
    assert GLOOMHAVEN in shelved and JAWS in shelved


def test_seeding_may_exceed_capacity(seed_build):
    """A real collection clusters; cells over capacity are normal, not an error.

    Seeding bypasses `room()` deliberately, and `_bid_round` then skips any cell
    already at or over capacity. The grid must report the crowding rather than
    drop games the reader owns to make the arithmetic tidy.
    """
    games = seed_build["games"]
    cells, memb = _cells(seed_build)
    capacity = DEFAULTS.collection.picks_per_cell

    # Pile more games than fit into one cell, all of which genuinely reach it.
    target = max(cells, key=lambda k: len(cells[k]))
    crowd = [g for g in cells[target] if (target, g.id) in memb][:capacity + 4]
    assert len(crowd) > capacity

    results = allocate(cells, memb, _scorer(seed_build), capacity,
                       seeded={target: crowd}, sel=DEFAULTS.selection)
    kept = {a.game.id for a in results[target].assignments}
    assert {g.id for g in crowd} <= kept, "an owned game was dropped to fit"
    assert len(results[target].assignments) > capacity


def test_unseeded_cells_still_fill_normally(seed_build):
    """Crowding one cell must not starve the rest."""
    games = seed_build["games"]
    cells, memb = _cells(seed_build)
    target = max(cells, key=lambda k: len(cells[k]))
    crowd = [g for g in cells[target] if (target, g.id) in memb][:9]

    results = allocate(cells, memb, _scorer(seed_build),
                       DEFAULTS.collection.picks_per_cell,
                       seeded={target: crowd}, sel=DEFAULTS.selection)
    others = [len(r.assignments) for k, r in results.items() if k != target]
    assert sum(others) > 0 and max(others) <= DEFAULTS.collection.picks_per_cell
