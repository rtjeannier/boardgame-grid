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

    @property
    def url(self) -> str:
        return f"https://boardgamegeek.com/boardgame/{self.id}"

    @classmethod
    def from_dict(cls, d: dict) -> "Game":
        return cls(
            id=d["id"], name=d["name"], year=d["year"], rank=d["rank"],
            weight=d["weight"], playtime=d["playtime"],
            best_counts=d["best_counts"], best_count=d["best_count"],
            signals=d["signals"],
        )

    def record(self) -> dict:
        """Canonical serialisable fields — what gets stored in a dataset."""
        return {
            "id": self.id, "name": self.name, "year": self.year, "rank": self.rank,
            "weight": self.weight, "playtime": self.playtime,
            "best_counts": self.best_counts, "best_count": self.best_count,
            "signals": self.signals,
        }

    def to_dict(self) -> dict:
        """Record plus the derived URL — what the frontend consumes."""
        return {**self.record(), "url": self.url}
