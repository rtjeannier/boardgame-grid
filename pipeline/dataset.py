"""The dataset artifact that connects fetching to building.

A dataset is a single JSON file:

    {
      "source": "live" | "seed",
      "generatedAt": "2026-08-12T...",
      "games": [ { id, name, year, rank, weight, best_counts, best_count, signals }, ... ]
    }

`pipeline/fetch.py` writes one from live BGG data; `data/games.seed.json` is a
committed proxy in the same shape. `pipeline/build.py` reads one and doesn't
care which it got — so switching data sources is just pointing at a new file.
"""

import json
from pathlib import Path

from .model import Game


def load_dataset(path: str | Path) -> tuple[str, str, list[Game]]:
    """Return (source, generatedAt, games) from a dataset file."""
    data = json.loads(Path(path).read_text())
    games = [Game.from_dict(g) for g in data["games"]]
    return data["source"], data["generatedAt"], games


def save_dataset(path: str | Path, games: list[Game], source: str, generated_at: str):
    payload = {
        "source": source,
        "generatedAt": generated_at,
        "games": [g.record() for g in games],
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))
