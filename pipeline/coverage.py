"""Probabilistic coverage: the radar-chart selection model.

Picture a radar chart with one spoke per latent genre dimension. Each game
covers every axis with "probability" quality × loading, and a set of games
covers an axis unless *all* of them miss it:

    coverage(axis) = 1 - ∏ (1 - w_i)          over games i in the set

A candidate's marginal gain is therefore Σ w·(uncovered space) — literally
"how much of the empty chart it fills". Coverage functions are submodular, so
greedy selection over them is near-optimal (≥ 1-1/e of the best set).

This module is the maths only — `quality`, `axis_coverage`, `novelty`,
`unique_contribution`. Choosing games with it lives in `pipeline/assign.py`,
which drives one allocator over any stratification: the two-axis grid, or a
single cell holding the whole space for the collection builder.
"""

import numpy as np

from .params import DEFAULTS, Selection


def genre_quality(loadings: np.ndarray, ratings: np.ndarray,
                  sel: Selection = DEFAULTS.selection) -> np.ndarray:
    """(n_games x n_axes) — how good each game is *for each genre*.

    A game's coverage of a genre is quality x loading, and the question quality
    has to answer is "how good is this, for this kind of game". Rated against
    the whole population instead, a genre whose best game is merely very good
    could never be covered: Crokinole is the finest dexterity game in the corpus
    and rates 7.80 where the population tops out at 8.39, so it scored 0.68 and
    the dexterity axis sat two thirds empty however many dexterity games you
    owned. The ceiling was not the collection, it was BGG's rating spread.

    So each axis is scaled against the games that belong to *it* — its own worst
    to its own best — and a genre's leader scores 1.0 whatever the wider
    population thinks. Membership is peak-relative (GENRE_FLOOR), so
    a game counts towards every genre that is a real part of it.

    Note this is *within genre*, never within cell. A game's genres are a
    property of the game, so its weights are the same wherever it is considered
    and scores stay comparable across cells — which contests depend on.
    Normalising within a cell would make quality depend on which games happened
    to land beside it: in an 857-game cell holding ranks 3 to 4991, Orleans
    (#35) and Rajas of the Ganges (#170) both came out top-5% at 0.996 and
    0.975, a 135-place gap worth 0.02.

    QUALITY_EXPONENT still decides how much better a better game is. Rating is a
    narrow band and raising the normalised score to a power above 1 widens the
    gap between the top and the middle without inventing an ordering.
    """
    ratings = np.asarray(ratings, dtype=float)
    lo, hi = genre_rating_range(loadings, ratings, sel)

    out = np.zeros_like(loadings)
    for axis in range(loadings.shape[1]):
        normalised = np.clip((ratings - lo[axis]) / max(hi[axis] - lo[axis], 1e-9), 0.0, 1.0)
        out[:, axis] = (sel.quality_floor
                        + (1 - sel.quality_floor) * normalised ** sel.quality_exponent)
    return out


def genre_rating_range(loadings: np.ndarray, ratings: np.ndarray,
                       sel: Selection = DEFAULTS.selection):
    """Per axis, the rating span of the games that belong to it: `(lo, hi)`.

    Split out because it is the whole of what the frontend needs in order to
    compute quality itself. Shipping resolved per-game quality would be larger
    and, worse, would freeze the reference population — filter the corpus and a
    genre's span moves, so a precomputed quality would quietly be answering a
    question about games that are no longer on screen.

    Membership is peak-relative, the same test `genre_overlap` and genre naming
    use: an axis counts as part of a game when it carries at least `genre_floor`
    of the game's strongest.
    """
    ratings = np.asarray(ratings, dtype=float)
    member = loadings >= sel.genre_floor * loadings.max(axis=1, keepdims=True)
    lo = np.array([ratings[member[:, a]].min() for a in range(loadings.shape[1])])
    hi = np.array([ratings[member[:, a]].max() for a in range(loadings.shape[1])])
    return lo, hi


def genre_weights(loadings: dict[int, np.ndarray],
                  ratings: dict[int, float],
                  sel: Selection = DEFAULTS.selection) -> dict[int, np.ndarray]:
    """Per game, its quality-scaled loading vector — coverage before membership.

    The one place this is computed, so the picker and the radar cannot drift
    apart: `assign.CoverageScorer` scales these by cell membership to score, and
    `build.py` serialises the same numbers for the frontend to draw.
    """
    ids = sorted(loadings)
    matrix = np.stack([loadings[i] for i in ids])
    scaled = matrix * genre_quality(matrix, np.array([ratings[i] for i in ids]), sel)
    return {i: scaled[k] for k, i in enumerate(ids)}


def axis_reach(loadings: np.ndarray, sel: Selection = DEFAULTS.selection) -> np.ndarray:
    """Per axis, the share of the corpus that loads on it at all.

    Peak-relative, the same membership test genre quality uses, so "reaches" here
    means the same thing it means everywhere else.
    """
    member = loadings >= sel.genre_floor * loadings.max(axis=1, keepdims=True)
    return member.mean(axis=0)


def axis_weights(spoke_of, reach, places: int | None = None) -> np.ndarray:
    """What each axis is worth when coverage is summed over all of them.

    Every spoke carries the same share, and within a spoke its axes divide that
    share in proportion to their reach:

        w(axis) = (1 / spokes) * reach(axis) / sum of reach across its spoke

    Counting each axis as 1 instead hands a spoke influence in proportion to how
    many pieces the clustering happened to cut it into, which is an artefact of
    the clustering and not a fact about games. Measured on the live corpus, the
    say each family had under flat weights against what it has under these:

        axes  spoke                          flat   here
          15  Area Majority / Influence     19.5%   8.3%
          12  Card Game                     15.6%   8.3%
           7  Cooperative Game               9.1%   8.3%
           5  Economic                       6.5%   8.3%
           3  Tile Placement                 3.9%   8.3%

    Scarcity is not already inside the loadings -- the correlation between an
    axis's reach and the mean loading on it is -0.053 -- so this is the first
    place it is applied and there is nothing to double-count.

    Normalised so the weights *average* 1 rather than summing to 1 — a spoke
    gets `axes / spokes` between its members, not `1 / spokes`. Ranking cannot
    see an overall scale, but two things can: `gain_floor` is an absolute
    threshold, and the gains shown to a reader are absolute numbers. Summing to
    1 divided every gain by 77 and the parity case that sets a gain floor went
    from 147 picks to 0, which is the whole corpus falling under the bar.

    `places` rounds to the precision the contract publishes. Both engines must
    read the *same* number, and the interface reads the rounded one, so the
    pipeline rounds too rather than scoring against a value it did not publish.
    """
    spoke_of = list(spoke_of)
    spokes = sorted(set(spoke_of))
    totals = {s: sum(float(reach[a]) for a, g in enumerate(spoke_of) if g == s)
              for s in spokes}
    share = len(spoke_of) / len(spokes)
    out = []
    for a, g in enumerate(spoke_of):
        total = totals[g]
        # A spoke whose axes all reach nothing still gets its share, split evenly
        # rather than divided by zero.
        out.append(share * float(reach[a]) / total if total > 0
                   else share / sum(1 for x in spoke_of if x == g))
    w = np.array(out, dtype=float)
    return np.round(w, places) if places is not None else w


def space_axis_weights(space, game_ids, sel: Selection = DEFAULTS.selection,
                       places: int | None = 4) -> np.ndarray:
    """`axis_weights` for a space and the games actually in it.

    Reach is a property of the corpus, so it is measured over the games being
    built from rather than over everything the space has ever seen. `places`
    defaults to the contract's precision: the interface scores against the
    published number, and the pipeline must score against the same one.
    """
    loadings = np.stack([space.loadings[i] for i in game_ids])
    return axis_weights(space.spoke_of, axis_reach(loadings, sel), places)


def axis_coverage(weight_rows: list[np.ndarray], n_axes: int) -> np.ndarray:
    """Per-axis coverage of a set: 1 - ∏(1 - w). Empty set covers nothing."""
    uncovered = np.ones(n_axes)
    for w in weight_rows:
        uncovered *= 1.0 - w
    return 1.0 - uncovered


def novelty(game_id: int,
            chosen_ids: list[int],
            similarity: dict[int, np.ndarray] | None,
            sel: Selection = DEFAULTS.selection) -> float:
    """How much of this game is *not* already on the shelf, in [0, 1].

    Why this exists: `axis_coverage` treats each game's coverage as an
    independent event, which is wrong for duplicates — two copies of one game
    are perfectly correlated, not independent. So a clone collects credit on
    every axis its original only partly covers, worth `sum(w) - 1` (0.65 for
    Twilight Imperium, 1.24 for Wingspan) — enough to win a slot outright. That
    is how both Twilight Imperium editions ended up in one cell.

    Scaling by this factor removes the credit at its source. Similarity is the
    max over picks, never the mean: the question is "is this a duplicate of *any
    one* game I hold", and a mean dilutes that with irrelevant comparisons,
    growing weaker exactly as the set fills up.
    """
    if similarity is None or not chosen_ids:
        return 1.0
    here = similarity[game_id]
    closest = max(float(here @ similarity[other]) for other in chosen_ids)
    # Clamped to [0, 1] because a cosine of unit vectors is *mathematically* in
    # that range but not numerically: 124 pairs on the live capture come out at
    # 1.0000000000000002, all of them games carrying identical tag sets. The
    # excess is 4e-16 and would be beneath notice, except that it makes this
    # return a tiny negative — and `CoverageScorer.score` then raises it to a
    # fractional power, which in Python yields a *complex number* rather than an
    # error. The score is silently poisoned until something tries to order it.
    return 1.0 - min(max(closest, 0.0), 1.0) ** sel.similarity_exponent


def unique_contribution(index: int, weight_rows: list[np.ndarray]) -> float:
    """Total coverage lost if member `index` were removed from the set.

    The honesty stat: an anchor whose unique contribution has shrunk to ~0 has
    been made redundant by later picks — we report it rather than prevent it.
    """
    n_axes = len(weight_rows[0])
    full = axis_coverage(weight_rows, n_axes)
    without = axis_coverage(weight_rows[:index] + weight_rows[index + 1:], n_axes)
    return round(float((full - without).sum()), 3)
