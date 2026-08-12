"""Archetype taxonomy: the "type" dimension of the grid.

A BGG game carries many mechanics/categories, so "what kind of game is this?"
has no single answer in the data. We define a curated list of archetypes, each
mapped to the BGG mechanic/category *names* that signal it. Matching by name
(not numeric id) keeps this readable and survives BGG's occasional id churn.

`specificity` breaks ties: when a game matches several archetypes, the higher
number wins as its defining type. "Worker Placement" is more characteristic of
a game than "Set Collection", which almost everything has a little of.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Archetype:
    label: str
    specificity: int
    # BGG mechanic/category `value` strings that mark a game as this archetype.
    signals: tuple[str, ...]


# Ordered roughly light-to-heavy for stable, readable output. Tune freely.
ARCHETYPES = [
    Archetype("Social Deduction", 95, ("Hidden Roles", "Traitor Game")),
    Archetype("Deck Building", 90, ("Deck, Bag, and Pool Building",)),
    Archetype("Worker Placement", 90, ("Worker Placement", "Worker Placement with Dice Workers")),
    Archetype("Engine Building", 85, ("Engine Building",)),
    Archetype("Area Control", 80, ("Area Majority / Influence", "Area Movement", "Area-Impulse")),
    Archetype("Route Building", 78, ("Network and Route Building",)),
    Archetype("Roll & Write", 78, ("Roll / Spin and Write", "Flip and Write", "Paper-and-Pencil")),
    Archetype("Dexterity", 78, ("Flicking", "Stacking and Balancing", "Action / Dexterity")),
    Archetype("Tile Placement", 70, ("Tile Placement",)),
    Archetype("Drafting", 68, ("Open Drafting", "Closed Drafting")),
    Archetype("Auction", 68, ("Auction/Bidding", "Auction: Turn Order Until Pass")),
    Archetype("Push Your Luck", 66, ("Push Your Luck",)),
    Archetype("Cooperative", 64, ("Cooperative Game",)),
    Archetype("Word / Party", 62, ("Word Game", "Party Game", "Acting", "Singing")),
    Archetype("Set Collection", 40, ("Set Collection",)),
]

_BY_LABEL = {a.label: a for a in ARCHETYPES}


def archetypes_for(signals: list[str]) -> list[Archetype]:
    """Every archetype a game matches, most-defining first.

    `signals` is the game's list of BGG mechanic/category names.
    """
    have = set(signals)
    matched = [a for a in ARCHETYPES if have.intersection(a.signals)]
    return sorted(matched, key=lambda a: a.specificity, reverse=True)


def primary_archetype(signals: list[str]) -> Archetype | None:
    """The single most-defining archetype, or None if the game matches none."""
    matched = archetypes_for(signals)
    return matched[0] if matched else None
