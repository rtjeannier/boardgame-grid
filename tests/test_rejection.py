"""Turning down a suggestion: ban the game, re-run the whole selection.

Selection is a grid-wide auction — a game is placed at most once anywhere, and
losing cells re-bid — so removing one game can free others. Re-running in full
is therefore both simpler and more correct than patching the single slot.

The ripple is usually nothing. What makes it worth a test is the case where it
is not: banning a game that was suppressing near-duplicates lets them onto the
grid, which looks like a bug and is the model working.
"""

import pytest

from pipeline import buckets
from pipeline.assign import CoverageScorer, allocate
from pipeline.params import DEFAULTS


def _run(seed_build, rejected=(), seeded=None):
    games, space = seed_build["games"], seed_build["space"]
    sel, coll = DEFAULTS.selection, DEFAULTS.collection
    rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)
    cells, memb = buckets.build_cells(
        games, [buckets.PlayerCountAxis(coll.columns(), sel),
                buckets.WeightAxis(rows, sel)], sel)
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of, sel)
    return allocate(cells, memb, scorer, coll.picks_per_cell, alternates_limit=6,
                    seeded=seeded, sel=sel, rejected=set(rejected))


def _shelved(results):
    return {a.game.id for r in results.values() for a in r.assignments}


@pytest.fixture(scope="module")
def victim(seed_build):
    """Some game that is actually on the grid, chosen deterministically."""
    picks = sorted(_shelved(seed_build["results"]))
    return picks[len(picks) // 2]


def test_rejected_game_leaves_the_grid(seed_build, victim):
    assert victim in _shelved(seed_build["results"])
    assert victim not in _shelved(_run(seed_build, {victim}))


def test_rejected_game_is_not_offered_as_an_alternate(seed_build, victim):
    """A runner-up you have already turned down is not a suggestion."""
    results = _run(seed_build, {victim})
    offered = {g.id for r in results.values() for g in r.alternates}
    assert victim not in offered


def test_the_slot_is_refilled(seed_build, victim):
    """Dropping a game must not leave a hole — something takes its place."""
    before = seed_build["results"]
    after = _run(seed_build, {victim})
    home = next(k for k, r in before.items() if victim in {a.game.id for a in r.assignments})
    assert len(after[home].assignments) == len(before[home].assignments)


def test_rejection_beats_ownership(seed_build, victim):
    """Owned *and* rejected is "I want rid of this", so rejection wins.

    Without this the game would be seeded into a cell and pinned there, and a
    reader who banned something they own would watch it stay put.
    """
    owned = next(g for g in seed_build["games"] if g.id == victim)
    home = next(k for k, r in seed_build["results"].items()
                if victim in {a.game.id for a in r.assignments})
    results = _run(seed_build, rejected={victim}, seeded={home: [owned]})
    assert victim not in _shelved(results)


def test_rejecting_nothing_changes_nothing(seed_build):
    base = {k: [a.game.id for a in r.assignments]
            for k, r in seed_build["results"].items()}
    again = {k: [a.game.id for a in r.assignments]
             for k, r in _run(seed_build).items()}
    assert base == again
