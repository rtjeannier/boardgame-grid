"""The config layer: defaults hold, overrides apply, typos fail loudly.

The point of this tier is that a sweep can reach every magnitude that changes
behaviour. Two things have to be true for that to be safe — an omitted key keeps
its default, and an *unknown* key is an error rather than a silent no-op. A
sweep that quietly ignores `gian_floor` reports a result for a configuration it
never ran.
"""

import tempfile
from pathlib import Path

import pytest

from pipeline import config
from pipeline.params import DEFAULTS, Params


def test_defaults_come_from_config():
    """config.py stays the documented source of every default.

    Each constant there carries the measurement that chose it. If params.py ever
    grows its own literals, that reasoning is orphaned.
    """
    p = Params()
    assert p.collection.picks_per_cell == config.PICKS_PER_CELL
    assert p.selection.gain_floor == config.GAIN_FLOOR
    assert p.selection.genre_floor == config.GENRE_FLOOR
    assert p.discovery.genre_spokes == config.GENRE_SPOKES
    assert p.discovery.continuous_scale == config.CONTINUOUS_SCALE
    assert p.presentation.gap_threshold == config.GAP_THRESHOLD


def test_omitted_keys_keep_defaults():
    with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as fh:
        fh.write("[hyper.selection]\ngain_floor = 0.25\n")
        path = fh.name
    p = Params.load(path)
    assert p.selection.gain_floor == 0.25
    assert p.selection.quality_exponent == DEFAULTS.selection.quality_exponent
    assert p.collection.picks_per_cell == DEFAULTS.collection.picks_per_cell


def test_unknown_key_is_an_error():
    """A typo must fail, not silently do nothing."""
    with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as fh:
        fh.write("[hyper.selection]\ngian_floor = 0.25\n")
        path = fh.name
    with pytest.raises(ValueError, match="gian_floor"):
        Params.load(path)


def test_replace_does_not_mutate():
    p = Params()
    q = p.replace(selection={"gain_floor": 0.9})
    assert q.selection.gain_floor == 0.9
    assert p.selection.gain_floor == DEFAULTS.selection.gain_floor
    with pytest.raises(ValueError):
        p.replace(selection={"nonsense": 1})


def test_toml_round_trips():
    """to_toml is what a sweep records beside its results, so it must be exact."""
    original = Params()
    path = Path(tempfile.mktemp(suffix=".toml"))
    path.write_text(original.to_toml())
    assert Params.load(path) == original


def test_open_ended_column_survives_toml():
    """TOML has no null: the 8+ column's absent upper bound writes as 0.

    A real upper bound of zero would be a column holding no player count at all,
    so the sentinel cannot collide with a meaningful value.
    """
    path = Path(tempfile.mktemp(suffix=".toml"))
    path.write_text(Params().to_toml())
    last = Params.load(path).collection.columns()[-1]
    assert last["label"] == "8+"
    assert last["lo"] == 9
    assert last["hi"] is None


def test_example_file_is_the_defaults():
    """grid.example.toml is generated, so it must not have drifted."""
    example = Path(__file__).resolve().parent.parent / "grid.example.toml"
    assert example.exists(), "grid.example.toml is missing"
    assert Params.load(example) == Params()
