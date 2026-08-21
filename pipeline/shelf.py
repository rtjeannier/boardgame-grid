"""What is on the reader's shelf, what earned its place, and what to change.

A game the reader owns can be in one of two positions, and the difference is the
whole point of this module.

A **keeper** is pinned: it goes on the grid whatever the maths says, because the
reader has decided. Sentimental favourites, the one their group always asks for,
the one they are not selling. `allocate(seeded=...)` places these.

Everything else they own simply **competes**. It is already in the corpus, so it
needs no special handling at all — it bids for a slot like any other game and
either earns one or does not. That is what makes "which of my collection is
pulling its weight?" answerable: run selection with only the keepers pinned, and
read off which owned games survived.

So the three lists a reader maintains — keepers, owned, banned — map onto
`seeded`, nothing, and `rejected`. Only the middle one needed no new mechanism.
"""

from dataclasses import dataclass, field

from . import coverage
from .assign import _capacity_lookup


@dataclass
class ShelfAudit:
    """Owned games sorted by what selection did with them."""
    keepers: list = field(default_factory=list)      # pinned, never contested
    earned: list = field(default_factory=list)       # owned and won a slot
    cut: list = field(default_factory=list)          # owned, lost to something better
    suggested: list = field(default_factory=list)    # not owned, worth acquiring

    def summary(self) -> str:
        return (f"{len(self.keepers)} kept, {len(self.earned)} earned their slot, "
                f"{len(self.cut)} cut, {len(self.suggested)} to add")


def audit(results: dict, owned: set[int], keepers: set[int] | None = None) -> ShelfAudit:
    """Sort every shelved and owned game into keepers / earned / cut / suggested.

    `cut` is the interesting list and the reason not to pin a whole collection by
    default: a game only appears there if the reader owns it and selection still
    preferred something else for every cell it reaches. Pin everything and that
    question can never be asked — the grid just agrees with whatever you already
    have.
    """
    keepers = keepers or set()
    shelved = {a.game.id: a.game for r in results.values() for a in r.assignments}

    return ShelfAudit(
        keepers=[g for gid, g in shelved.items() if gid in keepers],
        earned=[g for gid, g in shelved.items() if gid in owned and gid not in keepers],
        cut=sorted(owned - set(shelved), key=lambda gid: gid),
        suggested=[g for gid, g in shelved.items() if gid not in owned],
    )


def contributions(results: dict, weight_of) -> dict[int, float]:
    """Per shelved game, how much total coverage would vanish without it.

    The honesty stat, per cell rather than per collection: a game surrounded by
    near-neighbours contributes little even if it is excellent, which is exactly
    what a reader deciding what to cut needs to see. Wraps
    `coverage.unique_contribution`, which already computes it.
    """
    out = {}
    for key, result in results.items():
        rows = [weight_of(key, a.game) for a in result.assignments]
        for i, a in enumerate(result.assignments):
            out[a.game.id] = coverage.unique_contribution(i, rows)
    return out


def place(games, memberships: dict) -> tuple[dict, list]:
    """Each game into the one cell it belongs to most, ready for `seeded=`.

    `allocate` takes `seeded` keyed by cell, so somebody has to decide where an
    imported game goes — and nothing did. A game belongs to several cells by
    degree, so the answer is simply its strongest: membership is a property of
    the game, not of what else landed beside it, so the choice does not depend
    on ordering and cannot cascade.

    Returns `(seeded, unplaceable)`. A game reaches no cell at all when the
    community rejects every player count it might sit in, or when its weight
    falls outside every row — rare, but silently dropping it would leave a
    reader wondering where their game went.
    """
    reach: dict[int, dict] = {}
    for (key, gid), degree in memberships.items():
        reach.setdefault(gid, {})[key] = degree

    seeded: dict = {}
    unplaceable = []
    for game in games:
        here = reach.get(game.id)
        if not here:
            unplaceable.append(game)
            continue
        # Ties broken by the cell key so the same collection always lands the
        # same way; two cells reaching a game equally is otherwise arbitrary.
        best = max(sorted(here), key=here.get)
        seeded.setdefault(best, []).append(game)
    return seeded, unplaceable


@dataclass
class CellGap:
    """How much room a cell has left once the reader's own games are in it."""
    key: tuple
    capacity: int
    owned: int          # games here the reader already has
    shelved: int        # games here in total, owned or suggested
    gap: int            # slots the reader could still fill
    over: int           # games beyond capacity — crowding, not an error


def gaps(results: dict, capacity, owned: set[int]) -> list[CellGap]:
    """Per cell, how many slots the reader has left to fill.

    Seeding deliberately bypasses capacity, because a real collection clusters —
    2-4 players at medium weight — and dropping a game somebody owns to keep the
    arithmetic tidy would be worse than saying the cell is crowded. So `gap` and
    `over` are both reported, and `gap` floors at zero rather than going
    negative.

    Sorted emptiest first, which is the order a reader shopping for games wants.
    """
    room = _capacity_lookup(capacity)
    out = []
    for key, result in results.items():
        ids = [a.game.id for a in result.assignments]
        mine = sum(1 for gid in ids if gid in owned)
        cap = room(key)
        out.append(CellGap(key=key, capacity=cap, owned=mine, shelved=len(ids),
                           gap=max(0, cap - mine), over=max(0, len(ids) - cap)))
    return sorted(out, key=lambda c: (-c.gap, c.key))
