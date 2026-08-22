"""The numbers a genre or selection change is judged on, computed rather than recalled.

Every substantive commit in this repo's history carries a measurement paragraph
in its body — median pick rank, canaries kept, name-truth, slots filled. Those
numbers were derived by hand or by throwaway scripts, so they could not be
reproduced, compared across branches, or checked by anything automatic. This
module is that convention turned into code.

Four measures, because most of the dead ends in this project's history were
visible on exactly one of them:

- **Cohesion** — do a genre's games actually resemble each other? The unbiased
  one: it does not care what a genre is called.
- **Name-truth** — does a genre's leading tag describe its members? Biased
  toward genres named after one dominant tag, which is why cohesion exists
  beside it.
- **Pick quality** — median rank of what got shelved, and how much of it sits
  past #1000.
- **Slots filled** — how much of the grid the selection could actually fill.

Report all four. A change that improves one and quietly costs another should be
described that way rather than as a win.
"""

import numpy as np

from .features import genre_overlap
from .params import DEFAULTS, Params

# Four well-known games checked on every build. Not an assertion: a canary
# dropping out can be correct — COLLECTION_WEIGHT exists precisely to make a
# second heavy engine-builder less welcome, and Terraforming Mars is 0.740
# similar to Gaia Project. Report which fell and let a human judge why.
CANARIES = ("Ark Nova", "Terraforming Mars", "Wingspan", "Brass: Birmingham")

# Ranks past this count as "reached deep" — the tail the picker had to go into.
DEEP_RANK = 1000


def _gram(similarity: dict[int, np.ndarray], ids: list[int]) -> np.ndarray:
    """Pairwise cosine over the full tag space. Vectors are already unit-norm."""
    matrix = np.stack([similarity[i] for i in ids]).astype(np.float32)
    return matrix @ matrix.T


def _mean_offdiagonal(block: np.ndarray) -> float | None:
    """Mean similarity of distinct pairs. None when there is no pair to take."""
    n = block.shape[0]
    if n < 2:
        return None
    total = float(block.sum() - np.trace(block))
    return total / (n * (n - 1))


def cohesion(similarity: dict[int, np.ndarray], ids: list[int],
             primary: np.ndarray, n_groups: int) -> dict:
    """How alike a genre's own games are, as a multiple of the corpus null.

    The null is the average similarity of two random games — about 0.125 on the
    live capture — so a raw cosine means nothing on its own. Expressed as a
    multiple, a genre whose games are no more alike than chance scores 1.0.

    `primary` assigns each game to the one genre it is most of. Measured over
    whatever axes the design has, which is what makes two designs comparable:
    truncating discovery to twelve axes scored 2.58x where keeping all
    seventy-seven scores 3.11x.
    """
    gram = _gram(similarity, ids)
    null = _mean_offdiagonal(gram)
    if not null:
        return {"null": 0.0, "mean": 0.0, "per_group": {}}

    per_group = {}
    for g in range(n_groups):
        members = np.flatnonzero(primary == g)
        if members.size < 2:
            continue
        within = _mean_offdiagonal(gram[np.ix_(members, members)])
        if within is not None:
            per_group[g] = within / null

    values = list(per_group.values())
    return {
        "null": null,
        "mean": float(np.mean(values)) if values else 0.0,
        "per_group": per_group,
    }


def name_truth(names: list[str], signals: list[list[str]], primary: np.ndarray,
               separator: str = DEFAULTS.presentation.genre_name_separator) -> dict:
    """Share of a genre's own games that carry the tag it is named after.

    Only the *leading* tag counts, because that is all the frontend shows — a
    spoke reads as its first tag in the legend and on the radar. Compared
    case-insensitively: BGG ships some tags twice in different cases
    ("Real-time" and "Real-Time").

    Measured over the underlying axes rather than the radar spokes. A spoke is
    the sum of several axes and takes its name from only one of them, so asking
    whether a spoke's leading tag describes all its members asks the wrong
    question — it scores 66% where the axes score 83%, and the gap is spokes
    being deliberately broader than any one name.

    Known bias, and the reason cohesion sits beside this: a genre named after
    one huge tag scores well almost by construction. `Set Collection` reached
    97% partly because the tag is enormous.
    """
    per_group = {}
    for g, name in enumerate(names):
        members = np.flatnonzero(primary == g)
        if members.size == 0:
            continue
        lead = name.split(separator)[0].strip().lower()
        carried = sum(
            1 for i in members
            if any(tag.strip().lower() == lead for tag in signals[i])
        )
        per_group[g] = carried / members.size

    values = list(per_group.values())
    return {"mean": float(np.mean(values)) if values else 0.0, "per_group": per_group}


def pick_stats(results: dict, capacity) -> dict:
    """Median rank of what got shelved, how deep it reached, and how full it is."""
    picks = [a.game for result in results.values() for a in result.assignments]
    ranks = sorted(g.rank for g in picks)

    if callable(capacity):
        room = capacity
    elif isinstance(capacity, dict):
        room = lambda key: capacity.get(key, 0)   # noqa: E731
    else:
        room = lambda key: capacity               # noqa: E731
    slots = sum(room(key) for key in results)

    return {
        "picks": len(picks),
        "slots": slots,
        "unfilled": max(0, slots - len(picks)),
        "median_rank": int(np.median(ranks)) if ranks else 0,
        "past_deep": sum(1 for r in ranks if r > DEEP_RANK),
        "cells": len(results),
    }


def canary_status(results: dict) -> dict[str, bool]:
    """Which canaries are still somewhere on the grid. A smoke test, not a gate."""
    shelved = {a.game.name for result in results.values() for a in result.assignments}
    return {name: name in shelved for name in CANARIES}


def spread(results: dict, primary_of: dict[int, int]) -> dict:
    """How well the grid shows one game of each kind, cell by cell.

    `GENRE_REPEAT_PENALTY` exists to stop a cell taking two games of the same
    kind simply because one genre is numerous. These are the numbers that
    justified it: cells repeating a genre fell 27 of 34 to 1, and distinct
    genres per cell rose 3.79 to 4.63.
    """
    distinct, repeating = [], 0
    for result in results.values():
        kinds = [primary_of.get(a.game.id) for a in result.assignments]
        kinds = [k for k in kinds if k is not None]
        if not kinds:
            continue
        distinct.append(len(set(kinds)))
        if len(set(kinds)) < len(kinds):
            repeating += 1
    return {
        "distinct_per_cell": float(np.mean(distinct)) if distinct else 0.0,
        "cells_repeating": repeating,
        "cells_counted": len(distinct),
    }


def build_report(space, games, results, capacity, source: str,
                 params: Params = DEFAULTS) -> dict:
    """Everything above, over one build."""
    ids = [g.id for g in games]
    signals = [g.signals for g in games]

    axis_matrix = np.stack([space.loadings[i] for i in ids])
    spoke_matrix = np.stack([space.spokes[i] for i in ids])

    # A game with no signals claims no genre; argmax would silently hand it
    # axis 0 and quietly inflate whatever genre sits there.
    has_signal = spoke_matrix.any(axis=1)
    axis_primary = np.where(has_signal, axis_matrix.argmax(axis=1), -1)
    spoke_primary = np.where(has_signal, spoke_matrix.argmax(axis=1), -1)

    overlap = genre_overlap(space, params)
    worst, a, b = overlap[0]

    spoke_sizes = np.bincount(spoke_primary[spoke_primary >= 0],
                              minlength=len(space.dimension_names))

    return {
        "source": source,
        "games": len(games),
        "axes": axis_matrix.shape[1],
        "spokes": len(space.dimension_names),
        "cohesion_axis": cohesion(space.similarity, ids, axis_primary, axis_matrix.shape[1]),
        "cohesion_spoke": cohesion(space.similarity, ids, spoke_primary, spoke_matrix.shape[1]),
        # Over axes, using `axis_names` — which nothing else reads. The field
        # was added for this measure and then the measure was never written.
        "name_truth": name_truth(space.axis_names, signals, axis_primary,
                                 params.presentation.genre_name_separator),
        "name_truth_spoke": name_truth(space.dimension_names, signals, spoke_primary,
                                       params.presentation.genre_name_separator),
        "picks": pick_stats(results, capacity),
        "canaries": canary_status(results),
        "spread": spread(results, dict(zip(ids, spoke_primary))),
        "overlap": {
            "mean": float(np.mean([v for v, _, _ in overlap])),
            "worst": float(worst),
            "worst_pair": (space.dimension_names[a].split(params.presentation.genre_name_separator)[0],
                           space.dimension_names[b].split(params.presentation.genre_name_separator)[0]),
        },
        "biggest_genre": float(spoke_sizes.max() / max(len(games), 1)),
    }


def format_report(rep: dict) -> str:
    """The measurement paragraph a commit body wants, generated rather than typed."""
    picks, canaries = rep["picks"], rep["canaries"]
    kept = sum(canaries.values())
    lost = [name for name, ok in canaries.items() if not ok]

    lines = [
        f"  {rep['source']} data, {rep['games']} games, "
        f"{rep['axes']} axes in {rep['spokes']} spokes",
        f"  cohesion       {rep['cohesion_axis']['mean']:.2f}x null "
        f"(per axis) · {rep['cohesion_spoke']['mean']:.2f}x (per spoke) "
        f"· null {rep['cohesion_axis']['null']:.3f}",
        f"  name-truth     {rep['name_truth']['mean'] * 100:.0f}% "
        f"(per axis) · {rep['name_truth_spoke']['mean'] * 100:.0f}% (per spoke)",
        f"  median rank    {picks['median_rank']}   "
        f"({picks['past_deep']} past #{DEEP_RANK})",
        f"  slots filled   {picks['picks']}/{picks['slots']} "
        f"over {picks['cells']} cells"
        + (f"   ({picks['unfilled']} unfilled)" if picks["unfilled"] else ""),
        f"  canaries       {kept}/{len(canaries)}"
        + (f"   lost: {', '.join(lost)}" if lost else ""),
        f"  spread         {rep['spread']['distinct_per_cell']:.2f} genres/cell, "
        f"{rep['spread']['cells_repeating']} of {rep['spread']['cells_counted']} repeating",
        f"  overlap        mean {rep['overlap']['mean']:.3f}, "
        f"worst {rep['overlap']['worst']:.3f} "
        f"({rep['overlap']['worst_pair'][0]} / {rep['overlap']['worst_pair'][1]})",
        f"  biggest genre  {rep['biggest_genre'] * 100:.0f}% of corpus",
    ]
    return "\n".join(lines)
