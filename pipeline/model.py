"""The one data type that flows through the whole pipeline: `Game`.

Both the live BGG client and the offline seed data produce `Game` objects, so
everything downstream (bucketing, assignment, rendering) is source-agnostic.
"""

from dataclasses import dataclass, asdict


@dataclass
class Game:
    id: int
    name: str
    year: int
    rank: int          # overall BGG rank; lower is better (1 = #1 game)
    weight: float      # BGG "averageweight", 1.0 (light) .. 5.0 (heavy)
    best_counts: list[int]   # community best/recommended player counts
    signals: list[str]       # BGG mechanic + category names (drive archetypes)

    @property
    def url(self) -> str:
        return f"https://boardgamegeek.com/boardgame/{self.id}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["url"] = self.url
        return d
