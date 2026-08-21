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
    # BGG's Bayesian average — the score that *produces* `rank`, and the honest
    # measure of how much better one game is than another. Rank is a dense
    # ordering of a narrow band: #1 scores 8.39 and #5000 scores 5.79, so a
    # 135-place gap can be worth 0.4 of a point. Selection weights by this, not
    # by rank position (see coverage.genre_quality).
    rating: float
    weight: float      # BGG "averageweight", 1.0 (light) .. 5.0 (heavy)
    playtime: int      # BGG "playingtime", minutes
    best_counts: list[int]   # every count the community rates "Best" (for display)
    best_count: int          # the single peak count — decides the game's column
    signals: list[str]       # BGG mechanic + category names (drive archetypes)
    # BGG "Game: X" family links — the marker that two entries are the same game
    # (editions, reimplementations, spin-offs). Kept out of `signals` on purpose:
    # signals feed the clustered genre axes, where family tokens would pollute
    # the axis names; only the similarity space uses these.
    families: list[str]
    # BGG "boardgameimplementation" links, as ids, in both directions — its
    # explicit statement that one game is a reimplementation of another. Where a
    # family says "these are related", this says "this IS that game, redone".
    # Inside `Game: Werewolf / Mafia`, thirty unrelated social-deduction games,
    # these links are silent between the unrelated ones and present only within
    # real lineages, which is what no heuristic over names or tags managed.
    #
    # Ids rather than names, since names are not stable and a link may point at
    # a game outside the captured slice.
    reimplements: list[int]
    # The whole suggested-players poll: count -> [best, recommended, not_rec].
    # All three are needed because Best alone is a preference ordering, not a
    # verdict on a count — see buckets.player_memberships.
    player_poll: dict[int, list[int]]
    # How many people have rated the game. Nothing in the pipeline reads it:
    # it once weighted how much of a game's claimed genre split to believe, and
    # that use was removed in c211708 when genre axes moved to tag
    # co-occurrence. Kept because it is what tells a reader whether a rating is
    # worth anything — 8.4 from 60,000 voters and 8.4 from 300 are not the same
    # claim — and the frontend should say so.
    users_rated: int

    @property
    def url(self) -> str:
        return f"https://boardgamegeek.com/boardgame/{self.id}"

    @classmethod
    def from_dict(cls, d: dict) -> "Game":
        return cls(
            id=d["id"], name=d["name"], year=d["year"], rank=d["rank"],
            rating=d["rating"], weight=d["weight"], playtime=d["playtime"],
            best_counts=d["best_counts"], best_count=d["best_count"],
            signals=d["signals"], families=d["families"],
            # Absent from datasets captured before implementation links were read.
            reimplements=d.get("reimplements", []),
            # JSON object keys are strings; the poll is keyed by player count.
            player_poll={int(k): v for k, v in d["player_poll"].items()},
            users_rated=d["users_rated"],
        )

    def record(self) -> dict:
        """Canonical serialisable fields — what gets stored in a dataset."""
        return {
            "id": self.id, "name": self.name, "year": self.year, "rank": self.rank,
            "rating": self.rating, "weight": self.weight, "playtime": self.playtime,
            "best_counts": self.best_counts, "best_count": self.best_count,
            "signals": self.signals, "families": self.families,
            "reimplements": self.reimplements,
            "player_poll": self.player_poll,
            "users_rated": self.users_rated,
        }

    def to_dict(self) -> dict:
        """Record plus the derived URL — what the frontend consumes."""
        return {**self.record(), "url": self.url}
