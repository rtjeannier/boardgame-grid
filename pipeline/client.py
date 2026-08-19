"""Live BoardGameGeek client (the `--live` path).

BGG's XML API2 has no "give me the top N" call, so we do it in two steps:

  1. Read the ranks dump to get game ids *in rank order*.
  2. Hydrate those ids in batches via /thing?stats=1 for weight, player-count
     polls, mechanics and categories.

Step 1 used to scrape the HTML browse pages; Cloudflare now 403s those, so we
read BGG's own ranks CSV instead (config.RANKS_CSV) — same ordering, no
scraping. Step 2 needs an API token: the XML API answers unauthenticated
requests with 401, so every call carries `Authorization: Bearer $BGG_API_TOKEN`.

Everything is cached to disk (data/cache/) so re-runs are instant and polite.
The XML API is rate-limited and answers big/queued requests with HTTP 202, so
we back off and retry. `requests` is imported lazily — the offline seed build
never touches the network and needs no dependencies.
"""

import csv
import os
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from .config import CACHE_DIR, RANKS_CSV
from .model import Game

THING_URL = "https://boardgamegeek.com/xmlapi2/thing"
BATCH_SIZE = 20            # ids per /thing call
REQUEST_PAUSE = 2.0       # seconds between calls; BGG asks for a light touch

# Both come from the environment (the devcontainer forwards them from the host)
# so no credential is ever committed. BGG asks that the agent string identify
# the client and a contact address.
TOKEN_ENV = "BGG_API_TOKEN"
AGENT_ENV = "BGG_USER_AGENT"


class BggClient:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._session = None

    # --- public API ---------------------------------------------------------

    def top_games(self, limit: int) -> list[Game]:
        """The top `limit` ranked games, hydrated into Game objects."""
        ids = self._ranked_ids(limit)
        games: list[Game] = []
        for start in range(0, len(ids), BATCH_SIZE):
            batch = ids[start:start + BATCH_SIZE]
            games.extend(self._things(batch))
        return games

    # --- step 1: ranked ids -------------------------------------------------

    def _ranked_ids(self, limit: int) -> list[int]:
        """The top `limit` ids in rank order, straight from the ranks dump.

        Unranked rows carry rank 0 and expansions are ranked separately, so
        filtering to a positive `rank` leaves exactly the base-game ladder the
        grid wants.
        """
        if not RANKS_CSV.exists():
            raise RuntimeError(
                f"Ranks dump not found at {RANKS_CSV}. Download boardgames_ranks.csv "
                "from https://boardgamegeek.com/data_dumps/bg_ranks (BGG account "
                "required) and unzip it there."
            )
        with RANKS_CSV.open(newline="") as fh:
            ranked = [
                (int(row["rank"]), int(row["id"]))
                for row in csv.DictReader(fh)
                if row["rank"].isdigit() and int(row["rank"]) > 0
            ]
        ranked.sort()
        return [game_id for _, game_id in ranked[:limit]]

    # --- step 2: hydrate ----------------------------------------------------

    def _things(self, ids: list[int]) -> list[Game]:
        joined = ",".join(str(i) for i in ids)
        xml = self._get_text(
            f"{THING_URL}?id={joined}&stats=1",
            cache_key=f"thing-{ids[0]}-{ids[-1]}.xml",
        )
        root = ET.fromstring(xml)
        games = [self._parse_item(item) for item in root.findall("item")]
        return [g for g in games if g is not None]

    @staticmethod
    def _parse_item(item: ET.Element) -> Game | None:
        ratings = item.find("statistics/ratings")
        rank_el = item.find("statistics/ratings/ranks/rank[@name='boardgame']")
        rank = rank_el.get("value") if rank_el is not None else "Not Ranked"
        if rank in (None, "Not Ranked"):
            return None  # unranked games have no place on the grid

        poll = _player_poll(item)
        # Counts the community endorses outright — what BGG's own "Best: 3-6"
        # label shows, kept for display and for the per-cell assigners.
        endorsed = {n: v[0] for n, v in poll.items() if v[0] > 0 and v[0] >= v[2]}
        best_counts = sorted(endorsed)
        best_count = max(endorsed, key=lambda n: (endorsed[n], -n)) if endorsed else None
        name_el = item.find("name[@type='primary']")
        return Game(
            id=int(item.get("id")),
            name=name_el.get("value"),
            year=int(item.find("yearpublished").get("value")),
            rank=int(rank),
            rating=float(rank_el.get("bayesaverage")),
            weight=float(ratings.find("averageweight").get("value")),
            playtime=int(item.find("playingtime").get("value")),
            best_counts=best_counts,
            best_count=best_count,
            signals=_signals(item),
            families=_families(item),
            player_poll=poll,
            users_rated=int(ratings.find("usersrated").get("value")),
        )

    # --- low-level HTTP with cache + backoff --------------------------------

    def _get_text(self, url: str, cache_key: str) -> str:
        cached = self.cache_dir / cache_key
        if cached.exists():
            return cached.read_text()

        import requests
        if self._session is None:
            token = os.environ.get(TOKEN_ENV)
            if not token:
                raise RuntimeError(
                    f"{TOKEN_ENV} is not set. The XML API answers unauthenticated "
                    "requests with 401 — create a token at "
                    "https://boardgamegeek.com/using_the_xml_api and export it "
                    "on the host so the devcontainer forwards it in."
                )
            agent = os.environ.get(AGENT_ENV)
            if not agent:
                raise RuntimeError(
                    f"{AGENT_ENV} is not set. BGG asks that the agent string name "
                    "the client and a contact address; a generic fallback would "
                    "misrepresent who is calling."
                )
            self._session = requests.Session()
            self._session.headers["User-Agent"] = agent
            self._session.headers["Authorization"] = f"Bearer {token}"

        for attempt in range(5):
            resp = self._session.get(url, timeout=30)
            if resp.status_code == 200:
                cached.write_text(resp.text)
                time.sleep(REQUEST_PAUSE)
                return resp.text
            if resp.status_code in (401, 403):
                raise RuntimeError(  # a bad token never becomes a good one
                    f"BGG rejected the request ({resp.status_code}): {resp.text[:120]}"
                )
            # 202 = queued, 429 = slow down. Wait longer each time.
            time.sleep(REQUEST_PAUSE * (attempt + 1))
        raise RuntimeError(f"BGG did not return data for {url}")


def _player_poll(item: ET.Element) -> dict[int, list[int]]:
    """The suggested-players poll, whole: count -> [best, recommended, not_rec].

    All three counts are kept because Best alone answers the wrong question.
    Best is a *preference ordering* — a vote for four players is a vote taken
    away from five — so Cartographers, which 92% of voters say plays well at
    five, scored 108 Best against 248 at four and looked like a 44% five-player
    game. How good a count is and which count people like most are different
    things; `buckets.player_memberships` blends them, and the blend is a
    config knob rather than something baked in here.

    Rows labelled "N+" mean *more than* N and are skipped, not folded into N.
    They used to be: `"6+".rstrip("+")` is `"6"`, so the open-ended row silently
    overwrote the real one for 77 games — Sons of Anarchy's 48 four-player Best
    votes were replaced by its "4+" row's 10.
    """
    poll = item.find("poll[@name='suggested_numplayers']")
    if poll is None:
        return {}
    result: dict[int, list[int]] = {}
    for results in poll.findall("results"):
        label = results.get("numplayers", "")
        if not label.isdigit():        # skips "N+" and anything else non-numeric
            continue
        votes = {r.get("value"): int(r.get("numvotes", 0)) for r in results.findall("result")}
        counts = [votes.get("Best", 0), votes.get("Recommended", 0),
                  votes.get("Not Recommended", 0)]
        if sum(counts):
            result[int(label)] = counts
    return result


def _signals(item: ET.Element) -> list[str]:
    """BGG mechanic + category names — the raw material for archetype matching."""
    wanted = {"boardgamemechanic", "boardgamecategory"}
    return [link.get("value") for link in item.findall("link") if link.get("type") in wanted]


def _families(item: ET.Element) -> list[str]:
    """BGG "Game: X" family links — the same-game marker.

    BGG files a game under many families; only the `Game:` ones say "this is the
    same game as that one" (Game: Twilight Imperium, Game: Wingspan). The rest
    are production trivia — Crowdfunding: Kickstarter, Components: Sand Timers —
    and including them measurably *hurts* duplicate detection, so filter here.
    """
    return [
        link.get("value") for link in item.findall("link[@type='boardgamefamily']")
        if link.get("value", "").startswith("Game:")
    ]
