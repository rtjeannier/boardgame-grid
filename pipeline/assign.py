"""Filling each cell with one game per archetype (the de-duplication step).

This is the interesting, swappable part of the pipeline. Given the games that
qualify for a single cell, an *assigner* decides which game claims each
archetype slot, so a cell never shows two worker-placement games.

Design notes
------------
* `Assigner` is a tiny protocol — swap in a different strategy (ILP, weighted
  matching, ML-ranked, ...) by writing one `assign()` method.
* Each cell is assigned **independently** of every other cell, so the grid is
  embarrassingly parallel: `assign_grid` maps the assigner over cells and could
  be handed to a thread/process pool unchanged. We keep it sequential here
  because the work is tiny; the independence is the point.
"""

from dataclasses import dataclass
from typing import Protocol

from .archetypes import archetypes_for
from .model import Game


@dataclass
class Assignment:
    archetype: str
    game: Game


@dataclass
class CellResult:
    assignments: list[Assignment]   # one game per claimed archetype
    alternates: list[Game]          # qualified games that didn't get a slot


class Assigner(Protocol):
    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        """Choose one game per archetype from the games qualifying for a cell."""
        ...


class GreedyAssigner:
    """Walk games best-rank-first; each claims its most-defining free archetype.

    Because we go in rank order, the top-ranked game gets first pick of its
    signature archetype, the next game takes the best archetype still open, and
    so on. Simple, fast, and produces an intuitive "best of each type" cell.
    """

    def assign(self, games: list[Game], alternates_limit: int) -> CellResult:
        ranked = sorted(games, key=lambda g: g.rank)
        taken: set[str] = set()
        assignments: list[Assignment] = []
        leftovers: list[Game] = []

        for game in ranked:
            claimed = next(
                (a.label for a in archetypes_for(game.signals) if a.label not in taken),
                None,
            )
            if claimed:
                taken.add(claimed)
                assignments.append(Assignment(claimed, game))
            else:
                leftovers.append(game)

        return CellResult(assignments, leftovers[:alternates_limit])


def assign_grid(cells: dict, assigner: Assigner, alternates_limit: int) -> dict:
    """Apply an assigner to every cell. `cells` maps (col, row) -> [Game].

    Returns the same keys mapped to `CellResult`. Cells are independent, so this
    map is trivially parallelisable if a strategy ever gets expensive.
    """
    return {key: assigner.assign(games, alternates_limit) for key, games in cells.items()}
