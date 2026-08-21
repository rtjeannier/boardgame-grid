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


def test_place_puts_each_game_in_its_strongest_cell(seed_build):
    """`allocate(seeded=)` is keyed by cell, so somebody must choose. Nothing did."""
    from pipeline.shelf import place
    games, cells, memb, _ = _setup(seed_build)
    sample = [g for g in games[:20] if _best_cell(memb, g.id)]

    seeded, unplaceable = place(sample, memb)

    placed = {g.id: k for k, gs in seeded.items() for g in gs}
    assert len(placed) + len(unplaceable) == len(sample)
    for g in sample:
        if g.id in placed:
            assert placed[g.id] == _best_cell(memb, g.id)


def test_place_reports_games_that_reach_no_cell(seed_build):
    """Silently dropping one leaves a reader wondering where their game went."""
    from pipeline.shelf import place
    games, _, memb, _ = _setup(seed_build)
    reached = {gid for (_, gid) in memb}
    stranded = [g for g in games if g.id not in reached]

    seeded, unplaceable = place(stranded[:3] if stranded else [], memb)
    assert seeded == {}
    assert len(unplaceable) == len(stranded[:3])


def test_place_is_deterministic(seed_build):
    """A tie between two cells must not depend on dict ordering."""
    from pipeline.shelf import place
    games, _, memb, _ = _setup(seed_build)
    a, _ = place(games[:30], memb)
    b, _ = place(list(reversed(games[:30])), memb)
    assert {k: sorted(g.id for g in v) for k, v in a.items()} == \
           {k: sorted(g.id for g in v) for k, v in b.items()}


def test_gaps_counts_slots_the_reader_could_still_fill(seed_build):
    from pipeline.shelf import gaps
    capacity = DEFAULTS.collection.picks_per_cell
    results = seed_build["results"]
    some_cell = next(iter(results))
    mine = {a.game.id for a in results[some_cell].assignments}

    report = {c.key: c for c in gaps(results, capacity, owned=mine)}
    assert report[some_cell].owned == len(mine)
    assert report[some_cell].gap == max(0, capacity - len(mine))
    # A cell holding none of the reader's games has everything left to fill.
    other = next(k for k in results if k != some_cell)
    assert report[other].owned == 0
    assert report[other].gap == capacity


def test_gaps_reports_crowding_rather_than_going_negative(seed_build):
    """Seeding bypasses capacity on purpose; over-full is a finding, not an error."""
    from pipeline.assign import CoverageScorer, allocate
    from pipeline.shelf import gaps
    games, cells, memb, scorer = _setup(seed_build)
    capacity = DEFAULTS.collection.picks_per_cell
    target = max(cells, key=lambda k: len(cells[k]))
    crowd = [g for g in cells[target] if (target, g.id) in memb][:capacity + 3]

    results = allocate(cells, memb, scorer, capacity,
                       seeded={target: crowd}, sel=DEFAULTS.selection)
    here = next(c for c in gaps(results, capacity, {g.id for g in crowd})
                if c.key == target)
    assert here.over >= 3
    assert here.gap == 0, "gap floors at zero rather than going negative"


def test_gaps_are_sorted_emptiest_first(seed_build):
    from pipeline.shelf import gaps
    report = gaps(seed_build["results"], DEFAULTS.collection.picks_per_cell, owned=set())
    assert [c.gap for c in report] == sorted((c.gap for c in report), reverse=True)
