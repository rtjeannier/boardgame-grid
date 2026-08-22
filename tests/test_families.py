"""Colour families: balanced by construction, and never touching selection.

Twelve colours cannot be told apart. The palette these replace proved it — the
`Deduction · Party Game` and `Dice · Dice Rolling` spokes were ΔE 8.5 apart on a
ten-pixel dot, which is the same colour. Grouping the spokes into families lets
hue carry the family and lightness separate the pair, which measures better than
twelve free hues (ΔE 22.7 against 19.5).

The property that matters is balance: a family of one wastes a hue and a family
of four needs four lightness steps nobody can read. Cutting the dendrogram gives
neither, so `spoke_families` walks its ordering instead.
"""

import numpy as np
import pytest

from pipeline.contract import build_contract
from pipeline.features import spoke_families


@pytest.fixture(scope="module")
def families(seed_build):
    ids = [g.id for g in seed_build["games"]]
    spokes = np.stack([seed_build["space"].spokes[i] for i in ids])
    return spoke_families(spokes), spokes.shape[1]


def test_every_spoke_lands_in_exactly_one_family(families):
    assignment, n_spokes = families
    assert len(assignment) == n_spokes
    assert all(isinstance(f, int) and f >= 0 for f in assignment)


def test_families_are_balanced(families):
    """The whole reason for walking the ordering rather than cutting it.

    Cutting the live dendrogram at six puts `Economic`, `Card Game` and
    `Area Majority` — 39.6% of the corpus — in one family and leaves
    `Network and Route Building` alone at 3.9%, and no cut from five to eight
    separates that triple.
    """
    assignment, n_spokes = families
    sizes = np.bincount(assignment)
    assert sizes.max() <= 2, f"a family of {sizes.max()} needs unreadable lightness steps"
    assert sizes[:-1].min() == 2 if len(sizes) > 1 else True


def test_family_count_is_half_the_spokes(families):
    assignment, n_spokes = families
    assert len(set(assignment)) == (n_spokes + 1) // 2


def test_deterministic(seed_build):
    """Colour must not shuffle between builds of the same corpus."""
    ids = [g.id for g in seed_build["games"]]
    spokes = np.stack([seed_build["space"].spokes[i] for i in ids])
    assert spoke_families(spokes) == spoke_families(spokes)


def test_degenerate_inputs_do_not_raise():
    """Fewer spokes than a family holds, and a single spoke."""
    assert spoke_families(np.ones((10, 1))) == [0]
    assert spoke_families(np.ones((10, 2))) == [0, 0]
    odd = spoke_families(np.eye(5)[:, :5])
    assert len(odd) == 5 and max(np.bincount(odd)) <= 2


def test_a_larger_family_size_still_partitions(seed_build):
    ids = [g.id for g in seed_build["games"]]
    spokes = np.stack([seed_build["space"].spokes[i] for i in ids])
    assignment = spoke_families(spokes, size=3)
    assert max(np.bincount(assignment)) <= 3
    assert len(assignment) == spokes.shape[1]


def test_the_contract_carries_a_family_per_group(seed_build):
    payload = build_contract(seed_build["games"], seed_build["space"], None,
                             "seed", "2026-08-22T00:00:00Z")
    assert all("family" in g for g in payload["groups"])
    sizes = np.bincount([g["family"] for g in payload["groups"]])
    assert sizes.max() <= 2


def test_families_are_presentation_only(seed_build):
    """They must not reach selection. `policy` is what the engine applies."""
    payload = build_contract(seed_build["games"], seed_build["space"], None,
                             "seed", "2026-08-22T00:00:00Z")
    assert not any("family" in key.lower() for key in payload["policy"])
