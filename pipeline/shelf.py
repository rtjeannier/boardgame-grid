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
