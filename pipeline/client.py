"""Live BoardGameGeek client (the `--live` path).

BGG's XML API2 has no "give me the top N" call, so we do it in two steps:

  1. Read the ranked browse listing to get game ids *in rank order*.
  2. Hydrate those ids in batches via /thing?stats=1 for weight, player-count
     polls, mechanics and categories.

Everything is cached to disk (data/cache/) so re-runs are instant and polite.
The XML API is rate-limited and answers big/queued requests with HTTP 202, so
we back off and retry. `requests` is imported lazily — the offline seed build
never touches the network and needs no dependencies.
"""

import time
import xml.etree.ElementTree as ET
from pathlib import Path

from .config import CACHE_DIR
from .model import Game

BROWSE_URL = "https://boardgamegeek.com/browse/boardgame/page/{page}"
THING_URL = "https://boardgamegeek.com/xmlapi2/thing"
BATCH_SIZE = 20            # ids per /thing call
REQUEST_PAUSE = 2.0       # seconds between calls; BGG asks for a light touch


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
        import re
        ids: list[int] = []
        page = 1
        while len(ids) < limit:
            html = self._get_text(BROWSE_URL.format(page=page), cache_key=f"browse-{page}.html")
            found = [int(m) for m in re.findall(r"/boardgame/(\d+)/", html)]
            fresh = [i for i in dict.fromkeys(found) if i not in ids]  # keep order, de-dup
            if not fresh:
                break  # ran out of pages
            ids.extend(fresh)
            page += 1
        return ids[:limit]

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

        best_counts, best_count = _player_counts(item)
        name_el = item.find("name[@type='primary']")
        return Game(
            id=int(item.get("id")),
            name=name_el.get("value") if name_el is not None else "?",
            year=int(item.find("yearpublished").get("value", 0)),
            rank=int(rank),
            weight=float(ratings.find("averageweight").get("value")),
            playtime=int(item.find("playingtime").get("value", 0)),
            best_counts=best_counts,
            best_count=best_count,
            signals=_signals(item),
        )

    # --- low-level HTTP with cache + backoff --------------------------------

    def _get_text(self, url: str, cache_key: str) -> str:
        cached = self.cache_dir / cache_key
        if cached.exists():
            return cached.read_text()

        import requests
        if self._session is None:
            self._session = requests.Session()
            self._session.headers["User-Agent"] = "boardgame-grid/0.1"

        for attempt in range(5):
            resp = self._session.get(url, timeout=30)
            if resp.status_code == 200:
                cached.write_text(resp.text)
                time.sleep(REQUEST_PAUSE)
                return resp.text
            # 202 = queued, 429 = slow down. Wait longer each time.
            time.sleep(REQUEST_PAUSE * (attempt + 1))
        raise RuntimeError(f"BGG did not return data for {url}")


def _player_counts(item: ET.Element) -> tuple[list[int], int | None]:
    """Parse the suggested-players poll.

    Returns (best_counts, peak): every count the community rates "Best" (Best
    votes win and outnumber "Not Recommended"), plus the single peak — the
    qualifying count with the most "Best" votes, ties broken toward fewer
    players. Peak decides the game's column; the list is kept for display.
    """
    poll = item.find("poll[@name='suggested_numplayers']")
    if poll is None:
        return [], None
    best_votes: dict[int, int] = {}
    for results in poll.findall("results"):
        label = results.get("numplayers", "").rstrip("+")
        if not label.isdigit():
            continue
        votes = {r.get("value"): int(r.get("numvotes", 0)) for r in results.findall("result")}
        best = votes.get("Best", 0)
        not_rec = votes.get("Not Recommended", 0)
        if best > 0 and best >= not_rec:
            best_votes[int(label)] = best
    if not best_votes:
        return [], None
    counts = sorted(best_votes)
    peak = max(counts, key=lambda n: (best_votes[n], -n))
    return counts, peak


def _signals(item: ET.Element) -> list[str]:
    """BGG mechanic + category names — the raw material for archetype matching."""
    wanted = {"boardgamemechanic", "boardgamecategory"}
    return [link.get("value") for link in item.findall("link") if link.get("type") in wanted]
