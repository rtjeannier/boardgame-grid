"""Keepers, earned slots, and cuts — the three things a reader wants to know.

The distinction under test: pinning a whole collection makes the grid agree with
whatever the reader already owns, so it can never tell them what is not pulling
its weight. Only keepers get pinned; everything else they own competes.
"""

from pipeline import buckets
from pipeline.assign import CoverageScorer, allocate
from pipeline.params import DEFAULTS
from pipeline.shelf import audit, contributions


def _setup(seed_build):
    games, space = seed_build["games"], seed_build["space"]
    sel, coll = DEFAULTS.selection, DEFAULTS.collection
    rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)
    cells, memb = buckets.build_cells(
        games, [buckets.PlayerCountAxis(coll.columns(), sel),
                buckets.WeightAxis(rows, sel)], sel)
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of, sel)
    return games, cells, memb, scorer


def _best_cell(memb, gid):
    reach = {k: d for (k, i), d in memb.items() if i == gid}
    return max(reach, key=reach.get) if reach else None


def test_owned_games_that_lose_are_reported_as_cuts(seed_build):
    """Owning something is not the same as it earning a slot."""
    shelved = {a.game.id for r in seed_build["results"].values() for a in r.assignments}
    all_ids = {g.id for g in seed_build["games"]}
    a_loser = next(iter(all_ids - shelved))
    a_winner = next(iter(shelved))

    result = audit(seed_build["results"], owned={a_loser, a_winner})
    assert a_loser in result.cut
    assert a_winner in {g.id for g in result.earned}
    assert a_winner not in {g.id for g in result.suggested}


def test_keepers_are_separated_from_games_that_earned_their_place(seed_build):
    """Both are on the grid; only one of them got there on merit."""
    games, cells, memb, scorer = _setup(seed_build)
    shelved = {a.game.id for r in seed_build["results"].values() for a in r.assignments}
    unloved = next(g for g in games if g.id not in shelved and _best_cell(memb, g.id))
    home = _best_cell(memb, unloved.id)

    results = allocate(cells, memb, scorer, DEFAULTS.collection.picks_per_cell,
                       seeded={home: [unloved]}, sel=DEFAULTS.selection)
    earner = next(iter(shelved))
    result = audit(results, owned={unloved.id, earner}, keepers={unloved.id})

    assert unloved.id in {g.id for g in result.keepers}
    assert unloved.id not in {g.id for g in result.earned}
    assert unloved.id not in result.cut, "a pinned game is never a cut"


def test_pinning_everything_hides_the_question(seed_build):
    """Why the collection does not default to keepers.

    Pin the whole collection and `cut` is empty by construction — the grid
    agrees with whatever the reader owns and has nothing to tell them.
    """
    games, cells, memb, scorer = _setup(seed_build)
    owned = [g for g in games[:8] if _best_cell(memb, g.id)]
    seeded = {}
    for g in owned:
        seeded.setdefault(_best_cell(memb, g.id), []).append(g)

    results = allocate(cells, memb, scorer, DEFAULTS.collection.picks_per_cell,
                       seeded=seeded, sel=DEFAULTS.selection)
    ids = {g.id for g in owned}
    assert audit(results, owned=ids, keepers=ids).cut == []


def test_contributions_cover_every_shelved_game(seed_build):
    space = seed_build["space"]
    genre = space.loadings
    memb = seed_build["memberships"]

    def weight_of(key, game):
        return memb[(key, game.id)] * genre[game.id]

    values = contributions(seed_build["results"], weight_of)
    shelved = {a.game.id for r in seed_build["results"].values() for a in r.assignments}
    assert set(values) == shelved
    assert all(v >= 0 for v in values.values())


def test_summary_reads(seed_build):
    result = audit(seed_build["results"], owned=set())
    assert "to add" in result.summary()
