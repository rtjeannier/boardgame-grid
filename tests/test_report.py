"""The four numbers are computed, not recalled — so they need pinning too.

These values were reproduced against the figures recorded in this repo's commit
history for the live capture: cohesion 3.11x the corpus null, a null of 0.125,
median pick rank 267, 175/175 slots, and Terraforming Mars as the one canary
that legitimately drops. Four of those matched exactly, which is what gives
confidence the implementation is right rather than merely plausible.

The numbers below are the *seed* equivalents, since that is what a fresh clone
can reproduce.
"""

import pytest

from pipeline.config import PICKS_PER_CELL
from pipeline.report import CANARIES, build_report, format_report


@pytest.fixture(scope="session")
def seed_report(seed_build):
    return build_report(seed_build["space"], seed_build["games"],
                        seed_build["results"], PICKS_PER_CELL, seed_build["source"])


def test_headline_numbers(seed_report):
    """The seed baseline. Moving any of these is a result worth reporting."""
    assert seed_report["picks"]["picks"] == 162
    assert seed_report["picks"]["slots"] == 175
    assert seed_report["picks"]["median_rank"] == 169
    assert seed_report["axes"] == 89
    # How many spokes survive is an answer now, not a setting: clustering asks
    # for `GENRE_SPOKES + 1` and drops whatever falls below chance. Eleven on the
    # seed, twelve on the live capture.
    assert seed_report["spokes"] == 11


def test_cohesion_beats_chance(seed_report):
    """A genre whose games are no more alike than random scores 1.0.

    This is the unbiased measure — it does not care what a genre is called — so
    a design that stops clearing chance has stopped finding genres at all.
    """
    assert seed_report["cohesion_axis"]["null"] == pytest.approx(0.147, abs=0.005)
    assert seed_report["cohesion_axis"]["mean"] > 2.0
    assert seed_report["cohesion_spoke"]["mean"] > 1.5
    # No surviving spoke may sit at or below chance — that is what the
    # cohesion floor buys, and it is the whole reason the count is emergent.
    assert min(seed_report["cohesion_spoke"]["per_group"].values()) > 1.0


def test_name_truth_is_measured_over_axes(seed_report):
    """Axes are named for what they describe; spokes are deliberately broader.

    Spoke-level name-truth is *expected* to be lower — a spoke sums several axes
    and takes its name from one of them. Asserting the ordering keeps the two
    from being silently swapped.
    """
    assert seed_report["name_truth"]["mean"] > seed_report["name_truth_spoke"]["mean"]
    assert 0.5 < seed_report["name_truth"]["mean"] <= 1.0


def test_canaries_are_reported_not_asserted(seed_report):
    """All four are named, and a drop is a finding rather than a failure.

    Terraforming Mars legitimately falls off the live grid: it is 0.740 similar
    to Gaia Project, already shelved, and COLLECTION_WEIGHT exists precisely to
    make a second heavy engine-builder less welcome. Tuning constants to keep it
    would undo that mechanism, so this asserts the *shape* of the check only.
    """
    assert set(seed_report["canaries"]) == set(CANARIES)
    assert all(isinstance(v, bool) for v in seed_report["canaries"].values())


def test_report_formats_without_error(seed_report):
    text = format_report(seed_report)
    for label in ("cohesion", "name-truth", "median rank", "slots filled", "canaries"):
        assert label in text
