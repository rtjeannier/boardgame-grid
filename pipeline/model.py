"""The one data type that flows through the whole pipeline: `Game`.

Games come from a dataset file (see pipeline/dataset.py) — either the live BGG
capture or the committed seed proxy. Everything downstream (bucketing,
assignment, rendering) is identical regardless of which dataset was loaded.
"""

from dataclasses import dataclass


@dataclass
class Game:
    id: int
    name: str
    year: int
    rank: int          # overall BGG rank; lower is better (1 = #1 game)
    weight: float      # BGG "averageweight", 1.0 (light) .. 5.0 (heavy)
    playtime: int      # BGG "playingtime", minutes
    best_counts: list[int]   # every count the community rates "Best" (for display)
    best_count: int          # the single peak count — decides the game's column
    signals: list[str]       # BGG mechanic + category names (drive archetypes)
    # BGG "Game: X" family links — the marker that two entries are the same game
    # (editions, reimplementations, spin-offs). Kept out of `signals` on purpose:
    # signals feed the NMF genre axes, where family tokens would pollute the
    # dimension names; only the similarity space uses these.
    families: list[str]
    # Raw "Best" votes per player count, for counts the community endorses. This
    # is the distribution behind `best_count`: A Game of Thrones records 915 at
    # six players, 100 at five, 48 at four. The grid uses it for soft column
    # membership, so a game good at 3-6 appears in all of those columns instead
    # of only its peak.
    best_votes: dict[int, int]
    # How many people have rated the game — a proxy for how hard BGG's tagging
    # has been looked at. Tag count tracks popularity (rank vs tag count
    # correlates -0.35), so a sparsely-tagged game is usually unread rather than
    # genuinely simple; features.py uses this to decide how much of a game's
    # claimed genre split to believe.
    users_rated: int

    @property
    def url(self) -> str:
        return f"https://boardgamegeek.com/boardgame/{self.id}"

    @classmethod
    def from_dict(cls, d: dict) -> "Game":
        return cls(
            id=d["id"], name=d["name"], year=d["year"], rank=d["rank"],
            weight=d["weight"], playtime=d["playtime"],
            best_counts=d["best_counts"], best_count=d["best_count"],
            signals=d["signals"], families=d["families"],
            # JSON object keys are strings; the poll is keyed by player count.
            best_votes={int(k): v for k, v in d["best_votes"].items()},
            users_rated=d["users_rated"],
        )

    def record(self) -> dict:
        """Canonical serialisable fields — what gets stored in a dataset."""
        return {
            "id": self.id, "name": self.name, "year": self.year, "rank": self.rank,
            "weight": self.weight, "playtime": self.playtime,
            "best_counts": self.best_counts, "best_count": self.best_count,
            "signals": self.signals, "families": self.families,
            "best_votes": self.best_votes,
            "users_rated": self.users_rated,
        }

    def to_dict(self) -> dict:
        """Record plus the derived URL — what the frontend consumes."""
        return {**self.record(), "url": self.url}
