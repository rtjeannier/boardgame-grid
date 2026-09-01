"""The one file that stands between the model and the interface.

Everything the frontend needs, and nothing about how the model arrived at it.
The rule that makes the model replaceable is that this carries **resolved
quantities, never the knobs that produced them**: the interface computes a
game's quality from its rating and its genre's rating span, and never learns
that a `quality_exponent` exists as a design decision.

So a different model — text embeddings, an LLM taxonomy, a hand-written list —
fills the same shape without the interface noticing. What it must supply:

    dimensions   named axes, and the rating span of each
    groups       axes rolled up into a usable number of named families
    embedding    how a game divides itself between axes, L1-normalised
    playerFit    how well a game works at each player count, peak-relative
    sim          a unit-norm vector in whatever space the model measures
                 similarity in; the dims are opaque and only ever dotted
    policy       the constants live selection needs, applied blindly

Two things are deliberately *not* here. Per-game quality is derived rather than
shipped: it is a pure function of the three fields above, it was ~330 KB, and
precomputing it would freeze the reference population so that filtering the
corpus quietly asked a question about games no longer on screen. And the axis
definitions are absent because they are the reader's, not the model's — columns
and rows are built from `playerFit` and `weight` at runtime.
"""

import hashlib
import json

import numpy as np

from . import buckets, coverage
from .config import ROOT
from .params import DEFAULTS, Params
from .assign import GAIN_PLACES

OUTPUT = ROOT / "web" / "public" / "grid.contract.json"
VERSION = "boardgame-grid/1"

#: This does *not* control whether the two engines agree — `quantise` does, by
#: feeding both the numbers the contract carries. Parity holds at 3, 4 and 5
#: places alike, which is how it should be: agreement is a property of shared
#: inputs, not of having enough decimals.
#:
#: What it governs is fidelity to exact arithmetic. Rounding moves the odd
#: near-tie, so a contract-driven grid differs from an unrounded one in a cell
#: or two out of thirty-five at three places, and less above that. Four is the
#: balance: ~17 KB gzipped over three on the seed corpus, and it keeps the
#: shipped grid close to what full precision would pick.
#:
#: An earlier version rounded the genre rating spans to three places while
#: everything else moved to five, which put the engines permanently out of step —
#: quality is computed from those spans on both sides, so they are the one field
#: where a stray `round()` is not a rounding error but a fork.
PLACES = 4
#: Below this a loading is noise: it cannot lift an axis and it costs bytes.
SPARSE_FLOOR = 1e-4


def similarity_percentiles(space, ids) -> dict:
    """Where a similarity score sits among all pairs in the corpus.

    A cosine is not a percentage of sameness. Two unrelated games already score
    0.125 on average here, so zero is not the floor and 0.5 is not "half the
    same game" — it is the 96th percentile. Without these the interface can only
    quote the raw number, which reads as a claim it is not making.
    """
    matrix = np.stack([space.similarity[i] for i in ids]).astype(np.float32)
    gram = matrix @ matrix.T
    upper = gram[np.triu_indices(len(ids), 1)]
    marks = {f"p{q}": float(np.percentile(upper, q)) for q in (50, 75, 90, 95, 99)}
    marks["mean"] = float(upper.mean())
    return {k: round(v, 4) for k, v in marks.items()}


def quantise(value):
    """Round exactly as the payload does, so nothing sees more than it ships.

    The interface computes from the contract, and the contract carries rounded
    numbers — so asking the two implementations to agree while one of them reads
    full precision is asking for something neither can deliver. Errors of 1e-5
    are nothing until two candidates are 1e-5 apart, and in a corpus of five
    thousand games that happens.

    Chasing more decimals only moves the asymptote: two float implementations
    accumulate in different orders anyway. Feeding both the same numbers removes
    the question instead, and leaves any remaining disagreement meaning what it
    should — a genuine difference in logic.
    """
    if isinstance(value, dict):
        return {k: quantise(v) for k, v in value.items()}
    if isinstance(value, np.ndarray):
        out = np.round(value, PLACES)
        out[np.abs(out) < SPARSE_FLOOR] = 0.0
        return out
    return round(float(value), PLACES)


def quantise_games(games):
    """Copies carrying the rating and weight the contract ships."""
    from dataclasses import replace
    return [replace(g, rating=quantise(g.rating), weight=quantise(g.weight))
            for g in games]


class QuantisedSpace:
    """A feature space rounded to what the contract carries.

    `build_contract` runs selection through this for `defaultPicks`, so the
    precomputed grid is the one the browser reproduces rather than one it can
    only approximate.
    """

    def __init__(self, space):
        self.loadings = quantise(space.loadings)
        self.similarity = quantise(space.similarity)
        self.spoke_of = space.spoke_of
        self.dimension_names = space.dimension_names
        self.axis_names = space.axis_names
        self.projection = space.projection
        self.spokes = space.spokes
        self.top_genres = space.top_genres
        self.vectors = space.vectors


def _sparse(vector: np.ndarray) -> list:
    """`[[index, value], ...]` for the entries worth carrying."""
    idx = np.flatnonzero(np.abs(vector) >= SPARSE_FLOOR)
    return [[int(i), round(float(vector[i]), PLACES)] for i in idx]


def superseded(games) -> dict[int, list[int]]:
    """Which games are an impoverished record of another: `id -> [ids]`.

    "Is this the same design?" is a judgement the model makes, so the contract
    carries the *answer* rather than the tags to re-derive it from. Shipping raw
    signals and families would push a piece of the model into the interface —
    and cost about 1.2 MB doing it.

    What marks a re-recording is containment: every tag on one entry already on
    the other, so nothing distinguishes them to any part of this pipeline.
    `7 Wonders (Second Edition)` carries eleven tags and every one is on
    `7 Wonders`. Two games in a family are otherwise *not* the same game —
    `Wingspan Asia` brings `Economic` and `Push Your Luck` and keeps its slot.

    Only games sharing a BGG `Game:` family are compared, which is also what
    keeps this cheap: the corpus has 5,000 games but no family has many, so this
    is a few thousand comparisons rather than 25 million.
    """
    by_family: dict[str, list] = {}
    for game in games:
        for family in game.families:
            by_family.setdefault(family, []).append(game)

    out: dict[int, set] = {}
    for members in by_family.values():
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                sa, sb = set(a.signals), set(b.signals)
                if not sa or not sb:
                    continue
                if sa <= sb and len(sa) <= len(sb):
                    thin = a if (sa < sb or a.rank > b.rank) else b
                    rich = b if thin is a else a
                elif sb <= sa:
                    thin, rich = b, a
                else:
                    continue
                out.setdefault(thin.id, set()).add(rich.id)
    return {gid: sorted(rich) for gid, rich in out.items()}


def config_hash(params: Params) -> str:
    """Identifies the configuration `defaultPicks` was built under.

    The precomputed grid is only valid for the settings that produced it, so the
    interface discards it the moment the reader changes anything rather than
    showing results for a configuration they are no longer looking at.
    """
    return hashlib.sha256(params.to_toml().encode()).hexdigest()[:16]


def build_contract(games, space, results, source: str, generated_at: str,
                   params: Params = DEFAULTS) -> dict:
    ids = [g.id for g in games]
    sel = params.selection
    coll = params.collection
    thin = superseded(games)

    space = space if isinstance(space, QuantisedSpace) else QuantisedSpace(space)
    loadings = np.stack([space.loadings[i] for i in ids])
    ratings = np.array([quantise(g.rating) for g in games])
    lo, hi = coverage.genre_rating_range(loadings, ratings, sel)

    spoke_of = list(space.spoke_of)
    reach = coverage.axis_reach(loadings, sel)

    weight = coverage.axis_weights(spoke_of, reach, PLACES)

    dimensions = [
        {"id": a, "name": space.axis_names[a], "group": int(spoke_of[a]),
         "reach": round(float(reach[a]), PLACES),
         # What this axis is worth when coverage is summed. See `axis_weights`.
         "weight": round(float(weight[a]), PLACES),
         # Not rounded further: these are the min and max of ratings that are
         # already quantised, so they are exact at this precision — and quality
         # is computed from them on both sides, which makes them the one place a
         # stray `round()` would put the two engines permanently out of step.
         "ratingLo": float(lo[a]), "ratingHi": float(hi[a])}
        for a in range(loadings.shape[1])
    ]
    groups = [
        {"id": s, "name": name,
         "dimensions": [a for a, g in enumerate(spoke_of) if g == s]}
        for s, name in enumerate(space.dimension_names)
    ]

    payload = {
        "contract": VERSION,
        "model": {
            "name": "tag-cluster-coverage",
            "builtAt": generated_at,
            "corpus": f"{source}:{len(games)}",
            # Opaque to the interface; here so a result can be reproduced.
            "params": params.to_toml(),
        },
        "dimensions": dimensions,
        "groups": groups,
        # What a similarity score means, since the raw number does not say.
        "similarityScale": similarity_percentiles(space, ids),
        "games": [
            {
                "id": g.id, "name": g.name, "year": g.year, "rank": g.rank,
                "rating": quantise(g.rating), "usersRated": g.users_rated,
                "weight": quantise(g.weight), "playtime": g.playtime,
                "embedding": _sparse(space.loadings[g.id]),
                "playerFit": {str(c): quantise(f)
                              for c, f in sorted(buckets.player_fit(g, sel).items())},
                "xy": list(space.projection[g.id]),
                "sim": _sparse(space.similarity[g.id]),
                **({"kin": g.reimplements} if g.reimplements else {}),
                # Games that carry every tag this one does, and more, in the
                # same family — so this is the less informative record of them.
                **({"thin": thin[g.id]} if g.id in thin else {}),
            }
            for g in games
        ],
        # Model-fitted constants the live path needs. The interface applies them
        # and never shows them: they are not settings a reader should reason
        # about, and a different model ships different ones.
        "policy": {
            "qualityFloor": sel.quality_floor,
            "qualityExponent": sel.quality_exponent,
            "genreFloor": sel.genre_floor,
            "columnFloor": sel.column_floor,
            "cellFloor": sel.cell_floor,
            "weightTaper": sel.weight_taper,
            "similarityExponent": sel.similarity_exponent,
            "collectionWeight": sel.collection_weight,
            "repeatPenalty": sel.genre_repeat_penalty,
            "gainFloor": sel.gain_floor,
            "replacementKeep": sel.replacement_keep,
            "gainPlaces": GAIN_PLACES,
        },
        # What the interface starts from. Unlike `policy` these *are* settings a
        # reader may reason about and change; they ship so that first paint and
        # first interaction agree without the frontend keeping its own copy.
        "defaults": {
            "picksPerCell": coll.picks_per_cell,
            "autoDepth": coll.auto_depth,
            "autoDepthLeftover": coll.auto_depth_leftover,
            "representationEnough": coll.representation_enough,
            "weightRows": coll.weight_rows,
            "rowNames": list(params.presentation.row_names),
            "playerColumns": [
                {"label": c["label"], "lo": c["lo"], "hi": c["hi"]}
                for c in coll.columns()
            ],
        },
    }

    if results is not None:
        payload["defaultPicks"] = {
            "configHash": config_hash(params),
            "cells": {
                f"{key[0]}|{key[1]}" if len(key) > 1 else "|".join(map(str, key)): {
                    "picks": [a.game.id for a in result.assignments],
                    "gains": [None if a.gain is None else round(a.gain, 4)
                              for a in result.assignments],
                    "alternates": [g.id for g in result.alternates],
                }
                for key, result in sorted(results.items())
            },
        }
    return payload


def write(payload: dict, path=None) -> int:
    path = path or OUTPUT
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"))
    path.write_text(text)
    return len(text)
