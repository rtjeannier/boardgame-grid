"""The contract must be sufficient on its own, and its invariants must hold.

Sufficient because the interface is built against this file and nothing else —
if a field is missing the UI cannot compute it from somewhere. And invariant
because several of these properties are load-bearing in ways that fail silently:
an embedding that stops being L1-normalised does not raise, it just quietly
makes generalists beat specialists.
"""

import numpy as np
import pytest

from pipeline import coverage
from pipeline.contract import VERSION, build_contract, config_hash
from pipeline.params import DEFAULTS, Params


@pytest.fixture(scope="module")
def contract(seed_build):
    return build_contract(seed_build["games"], seed_build["space"],
                          seed_build["results"], "seed", "2026-08-21T00:00:00Z")


def test_shape(contract, seed_build):
    assert contract["contract"] == VERSION
    assert len(contract["games"]) == len(seed_build["games"])
    assert len(contract["groups"]) == len(seed_build["space"].dimension_names)
    assert len(contract["dimensions"]) == len(seed_build["space"].axis_names)


def test_every_dimension_belongs_to_exactly_one_group(contract):
    """`groups` is the genre-slider list, so an orphaned axis is unreachable."""
    grouped = [a for g in contract["groups"] for a in g["dimensions"]]
    assert sorted(grouped) == [d["id"] for d in contract["dimensions"]]
    assert len(grouped) == len(set(grouped)), "an axis is in two groups"


def test_embedding_is_l1_normalised(contract):
    """Σ loadings = 1. Under L2 a game touching k axes carries √k mass — 3.16x
    for a ten-axis sprawl — which exceeds the whole range of quality, so a
    bottom-ranked generalist outscores a top specialist and rating never
    catches up. Nothing raises when this breaks."""
    for game in contract["games"]:
        total = sum(v for _, v in game["embedding"])
        if total:
            assert total == pytest.approx(1.0, abs=0.02), game["name"]


def test_player_fit_is_peak_relative(contract):
    """Max 1.0, so a game equally good at 3-6 scores 1.0 four times rather than
    0.25 apiece. Columns aggregate by max, and share-of-total would punish
    versatility."""
    for game in contract["games"]:
        fit = game["playerFit"]
        if fit:
            assert max(fit.values()) == pytest.approx(1.0, abs=1e-3), game["name"]
            assert all(0 < v <= 1.0 for v in fit.values())


def test_similarity_vectors_are_unit_norm(contract):
    """Cosine is a dot product only if both sides are unit vectors."""
    for game in contract["games"][:200]:
        norm = np.sqrt(sum(v * v for _, v in game["sim"]))
        if norm:
            assert norm == pytest.approx(1.0, abs=0.02), game["name"]


def test_quality_is_derivable_from_the_contract(contract, seed_build):
    """The point of shipping rating spans instead of per-game quality.

    If this fails the interface cannot compute quality at all, and the contract
    is not sufficient — which is the one thing it has to be.
    """
    space, games = seed_build["space"], seed_build["games"]
    ids = [g.id for g in games]
    loadings = np.stack([space.loadings[i] for i in ids])
    expected = coverage.genre_quality(loadings, np.array([g.rating for g in games]))

    policy = contract["policy"]
    dims = {d["id"]: d for d in contract["dimensions"]}
    for i, game in enumerate(contract["games"][:150]):
        for axis, _ in game["embedding"]:
            lo, hi = dims[axis]["ratingLo"], dims[axis]["ratingHi"]
            norm = np.clip((game["rating"] - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
            got = (policy["qualityFloor"]
                   + (1 - policy["qualityFloor"]) * norm ** policy["qualityExponent"])
            assert got == pytest.approx(expected[i, axis], abs=1e-3)


def test_no_axis_definitions_are_shipped(contract):
    """Columns and rows are the reader's, not the model's.

    Shipping them would freeze the axes the UI is meant to let people redefine.
    """
    assert "playerColumns" not in contract
    assert "weightRows" not in contract
    for game in contract["games"][:50]:
        assert "player_poll" not in game, "raw votes would push the maths into the UI"


def test_policy_carries_no_discovery_knobs(contract):
    """`policy` is what live selection needs. A discovery knob here would be a
    control the UI could not honour without a rebuild."""
    forbidden = {"genreSpokes", "genreBaseRate", "genreGrowth", "genreMinLift",
                 "genreInteraction", "genreSpans", "genreScarcity", "continuousScale"}
    assert not (set(contract["policy"]) & forbidden)


def test_default_picks_are_keyed_to_their_configuration(contract):
    """Stale picks must be discardable, or the grid shows results for settings
    the reader is no longer looking at."""
    assert contract["defaultPicks"]["configHash"] == config_hash(Params())
    changed = Params().replace(collection={"picks_per_cell": 3})
    assert config_hash(changed) != config_hash(Params())


def test_kin_is_omitted_when_empty(contract):
    """Most games have no reimplementation link; carrying `[]` 5,000 times is
    payload for nothing."""
    assert any("kin" in g for g in contract["games"])
    assert any("kin" not in g for g in contract["games"])
