"""Selection is pinned: the same dataset must produce the same shelf.

`features.py` is 936 lines and `assign.py` 640, and until now a regression in
either was caught only by a human reading two printed lines and eyeballing a
3,800-line JSON diff. These tests are the floor under any change to the model,
the config plumbing, or the JS port.
"""

from pipeline import buckets
from pipeline.assign import CoverageScorer, allocate
from pipeline.config import ALTERNATES_PER_CELL, PICKS_PER_CELL, WEIGHT_ROW_COUNT

from .conftest import load_golden, picks_digest


def test_picks_match_golden(seed_build):
    """Every cell shelves the same games, in the same order, for the same gains."""
    actual = picks_digest(seed_build["results"])
    golden = load_golden("seed_picks.json")

    assert set(actual) == set(golden), "the set of filled cells changed"

    drifted = {
        key: {"golden": golden[key], "actual": actual[key]}
        for key in sorted(golden)
        if golden[key] != actual[key]
    }
    assert not drifted, (
        f"{len(drifted)} of {len(golden)} cells changed their picks. If this is "
        f"intended, run `python -m tests.regenerate_golden` and report which of "
        f"the four numbers moved (see pipeline/report.py). First: "
        f"{next(iter(drifted.items()))}"
    )


def test_allocation_is_deterministic(seed_build):
    """Contests must not hinge on dict iteration order.

    `allocate` sorts its keys for exactly this reason. A second run over the
    same inputs has to agree with the first, or none of the other tests here
    mean anything.
    """
    space, games = seed_build["space"], seed_build["games"]
    rows = buckets.build_weight_rows([g.weight for g in games], WEIGHT_ROW_COUNT)
    cells, memberships = buckets.build_cells(
        games, [buckets.PlayerCountAxis(), buckets.WeightAxis(rows)])
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of)
    again = allocate(cells, memberships, scorer, PICKS_PER_CELL,
                     alternates_limit=ALTERNATES_PER_CELL)

    assert picks_digest(again) == picks_digest(seed_build["results"])


def test_a_game_is_shelved_at_most_once(seed_build):
    """Grid-wide exclusivity: the whole point of allocating in rounds."""
    placed = [a.game.id
              for result in seed_build["results"].values()
              for a in result.assignments]
    duplicates = {gid for gid in placed if placed.count(gid) > 1}
    assert not duplicates, f"shelved more than once: {duplicates}"


def test_alternates_never_overlap_picks(seed_build):
    """A runner-up is a game that did *not* get a slot, anywhere on the grid."""
    placed = {a.game.id
              for result in seed_build["results"].values()
              for a in result.assignments}
    for key, result in seed_build["results"].items():
        clash = {g.id for g in result.alternates} & placed
        assert not clash, f"cell {key} lists shelved games as alternates: {clash}"
