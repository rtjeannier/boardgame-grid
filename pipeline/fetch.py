"""Capture live BoardGameGeek data into a dataset file.

    python -m pipeline.fetch                       # top 500 -> data/games.json
    python -m pipeline.fetch --limit 300 --out data/games.json

This is the only step that touches the network. Once it's written a dataset,
`python -m pipeline.build --dataset data/games.json` turns it into the grid.
"""

import argparse
from datetime import datetime, timezone

from . import dataset
from .client import BggClient
from .config import LIVE_DATASET


def main():
    parser = argparse.ArgumentParser(description="Fetch top BGG games into a dataset file.")
    parser.add_argument("--limit", type=int, default=500, help="how many top-ranked games to capture")
    parser.add_argument("--out", default=str(LIVE_DATASET), help="dataset file to write")
    args = parser.parse_args()

    games = BggClient().top_games(args.limit)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    dataset.save_dataset(args.out, games, source="live", generated_at=now)
    print(f"Wrote {args.out} — {len(games)} games (live)")


if __name__ == "__main__":
    main()
