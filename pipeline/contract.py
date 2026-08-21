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

OUTPUT = ROOT / "web" / "public" / "grid.contract.json"
VERSION = "boardgame-grid/1"

#: Loadings are L1-normalised and similarity is unit-norm, so three decimals sit
#: far below anything selection can see. Measured rather than assumed: rounding
#: the live capture to 6, 5, 4 and 3 places each moves *zero* picks across all
#: 35 cells, so there is margin either side of this. It matters more than it
#: looks — the interface computes from these values, so any precision the
#: contract drops is precision the two implementations cannot agree on.
PLACES = 3
#: Below this a loading is noise: it cannot lift an axis and it costs bytes.
SPARSE_FLOOR = 1e-4


def _sparse(vector: np.ndarray) -> list:
    """`[[index, value], ...]` for the entries worth carrying."""
    idx = np.flatnonzero(np.abs(vector) >= SPARSE_FLOOR)
    return [[int(i), round(float(vector[i]), PLACES)] for i in idx]


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

    loadings = np.stack([space.loadings[i] for i in ids])
    ratings = np.array([g.rating for g in games])
    lo, hi = coverage.genre_rating_range(loadings, ratings, sel)

    spoke_of = list(space.spoke_of)
    reach = (loadings >= sel.genre_floor * loadings.max(axis=1, keepdims=True)).mean(axis=0)

    dimensions = [
        {"id": a, "name": space.axis_names[a], "group": int(spoke_of[a]),
         "reach": round(float(reach[a]), PLACES),
         "ratingLo": round(float(lo[a]), 3), "ratingHi": round(float(hi[a]), 3)}
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
        "games": [
            {
                "id": g.id, "name": g.name, "year": g.year, "rank": g.rank,
                "rating": round(g.rating, 4), "usersRated": g.users_rated,
                "weight": round(g.weight, 4), "playtime": g.playtime,
                "embedding": _sparse(space.loadings[g.id]),
                "playerFit": {str(c): round(f, PLACES)
                              for c, f in sorted(buckets.player_fit(g, sel).items())},
                "xy": list(space.projection[g.id]),
                "sim": _sparse(space.similarity[g.id]),
                **({"kin": g.reimplements} if g.reimplements else {}),
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
