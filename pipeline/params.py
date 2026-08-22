"""Every tunable, in one object, in three tiers.

`config.py` remains where the *reasoning* lives — each constant there carries the
measurement that chose it, and those comments are the most valuable documentation
in this repo. This module reads those values as defaults and gives them a shape
that can be layered, passed around, and overridden from a file.

The three tiers are not cosmetic; they say who a value belongs to.

- **Presentation** — display only. Changing one alters what you see and never
  what gets picked.
- **Collection** — what a person manipulates: the axes, how deep the shelves go,
  which kinds of game they want reached for.
- **Hyper** — how the model is *fitted*. Tuned once against the four numbers in
  `report.py` and then left alone. These are not settings a user should reason
  about, which is why they get a config file and never a control.

`hyper` splits again by cost: `selection` runs on every recompute, `discovery`
re-runs tag clustering and forces a rebuild. That line is what makes an
interactive interface possible at all.

Nothing here is hardcoded elsewhere. A magnitude that changes behaviour and does
not appear in this file is a bug — the whole point is that a sweep can reach
every number that matters.

    params = Params.load("grid.toml")       # layered over the defaults
    params = Params()                        # the defaults themselves
    params.replace(selection={"gain_floor": 0.1})
"""

import tomllib
from dataclasses import dataclass, field, fields, replace
from pathlib import Path

from . import config


@dataclass(frozen=True)
class Presentation:
    """Display only. None of this moves a pick."""
    alternates_per_cell: int = config.ALTERNATES_PER_CELL
    suggestions_per_gap: int = config.SUGGESTIONS_PER_GAP
    gap_threshold: float = config.GAP_THRESHOLD
    genres_shown_per_game: int = config.GENRES_SHOWN_PER_GAME
    min_loading_shown: float = config.MIN_LOADING_SHOWN
    genre_top_signals: int = config.GENRE_TOP_SIGNALS
    row_names: tuple = tuple(config.WEIGHT_ROW_LADDER)
    # Cannot be " / ": BGG tag names contain that string ("Action / Dexterity"),
    # and the frontend splits on it to take a spoke's primary label.
    genre_name_separator: str = config.GENRE_NAME_SEPARATOR
    genre_compound: str = config.GENRE_COMPOUND


@dataclass(frozen=True)
class Collection:
    """What a person manipulates. This is exactly the state a UI serialises."""
    weight_rows: int = config.WEIGHT_ROW_COUNT
    picks_per_cell: int = config.PICKS_PER_CELL
    # Depth need not be chosen at all. `auto_depth` reads each axis's own curve
    # and stops where the fall is decisive; `picks_per_cell` is what applies
    # when it is not, and what a reader types over the top of either.
    auto_depth: bool = config.AUTO_DEPTH
    auto_depth_leftover: float = config.AUTO_DEPTH_LEFTOVER
    collection_size: int = config.COLLECTION_SIZE
    # Depth need not be uniform. The player columns are fixed ranges over a
    # lopsided distribution — `8+` holds 142 candidates against 5,577 for `4` —
    # so the same five slots mean very different things across the grid.
    #
    # Prefer `gain_floor` for that particular problem: it trims exactly the thin
    # column and nothing else, and it tracks the corpus instead of going stale.
    # These are for preference rather than scarcity — "we are four people, give
    # me more there" — and for capping a column outright.
    picks_per_column: dict = field(default_factory=dict)   # column label -> int
    picks_per_row: dict = field(default_factory=dict)      # row index (str) -> int
    # `hi` is stored as 0 rather than None for the open-ended column, so the
    # in-memory form and the TOML form are the same shape and round-trip.
    player_columns: tuple = tuple(
        (c["label"], c["lo"], c["hi"] or 0) for c in config.PLAYER_COLUMNS
    )
    # Per radar spoke, by name. Absent means 1.0. Zero means "never recommend
    # this kind" — applied to the *length of the spoke*, never to a game's
    # loadings, because scaling loadings both inverts the behaviour and
    # corrupts genre membership. See the contract's invariants.
    genre_weights: dict = field(default_factory=dict)

    def capacity(self, cell_keys) -> dict | int:
        """Slots per cell, as the complete mapping `allocate` wants.

        Complete because `assign._capacity_lookup` reads a dict with
        `.get(key, 0)` — a cell missing from it would silently get no slots at
        all rather than the default.

        Where a column and a row cap the same cell, the smaller wins: both are
        ceilings, so a cell at the intersection of "at most 2 at 8+" and "at
        most 3 in Heavy" holds 2.
        """
        if not (self.picks_per_column or self.picks_per_row):
            return self.picks_per_cell        # the scalar form; nothing to expand
        out = {}
        for key in cell_keys:
            caps = [self.picks_per_cell]
            if len(key) > 0 and key[0] in self.picks_per_column:
                caps.append(self.picks_per_column[key[0]])
            if len(key) > 1 and str(key[1]) in self.picks_per_row:
                caps.append(self.picks_per_row[str(key[1])])
            out[key] = min(caps)
        return out

    def axis_room(self, spoke_names: list[str], spoke_of) -> "list[float] | None":
        """Per axis, how much space its spoke offers. `None` when untouched.

        Weights are set per *spoke* because that is what a reader can reason
        about — twelve named families, against seventy-seven mined axes.
        """
        if not self.genre_weights:
            return None
        by_index = {i: float(self.genre_weights[name])
                    for i, name in enumerate(spoke_names)
                    if name in self.genre_weights}
        unknown = set(self.genre_weights) - set(spoke_names)
        if unknown:
            raise ValueError(
                f"unknown genre(s) in genre_weights: {', '.join(sorted(unknown))}")
        return [by_index.get(int(s), 1.0) for s in spoke_of]

    def columns(self) -> list[dict]:
        """Back into the shape `buckets.PlayerCountAxis` expects.

        TOML has no null, so an open-ended column ("8+", meaning nine or more)
        writes its upper bound as `0` and is read back as `None`. A real upper
        bound of zero would be a column holding no player count at all, so the
        sentinel cannot collide with a meaningful value.
        """
        return [{"label": label, "lo": lo, "hi": None if not hi else hi}
                for label, lo, hi in self.player_columns]


@dataclass(frozen=True)
class Selection:
    """Fitted, not chosen. Runs on every recompute; no rebuild needed."""
    quality_floor: float = config.QUALITY_FLOOR
    quality_exponent: float = config.QUALITY_EXPONENT
    genre_floor: float = config.GENRE_FLOOR
    column_floor: float = config.COLUMN_FLOOR
    cell_floor: float = config.CELL_FLOOR
    similarity_exponent: float = config.SIMILARITY_EXPONENT
    collection_weight: float = config.COLLECTION_WEIGHT
    replacement_keep: float = config.REPLACEMENT_KEEP
    genre_repeat_penalty: float = config.GENRE_REPEAT_PENALTY
    gain_floor: float = config.GAIN_FLOOR
    recommended_weight: float = config.RECOMMENDED_WEIGHT
    weight_taper: float = config.WEIGHT_TAPER


@dataclass(frozen=True)
class Discovery:
    """Fitted, and expensive. Changing any of these re-runs tag clustering.

    `genre_floor` is deliberately *not* here even though `features.py` reads it
    for naming: its primary consumer is `coverage.genre_quality` on the live
    path. Worth knowing that changing it warrants a rebuild anyway, or genre
    names drift out of step with the quality they are scored against.
    """
    genre_spokes: int = config.GENRE_SPOKES
    genre_min_reach: int = config.GENRE_MIN_REACH
    genre_reach_divisor: int = config.GENRE_REACH_DIVISOR
    genre_base_rate: float = config.GENRE_BASE_RATE
    genre_min_cohesion: float = config.GENRE_MIN_COHESION
    genre_growth: float = config.GENRE_GROWTH
    genre_min_lift: float = config.GENRE_MIN_LIFT
    genre_interaction: float = config.GENRE_INTERACTION
    genre_spans: float = config.GENRE_SPANS
    spanning_coverage: float = config.SPANNING_COVERAGE
    genre_scarcity: float = config.GENRE_SCARCITY
    continuous_scale: float = config.CONTINUOUS_SCALE


@dataclass(frozen=True)
class Baseline:
    """Reachable only through `--assigner mmr`. Kept for design comparisons."""
    mmr_lambda: float = config.MMR_LAMBDA


@dataclass(frozen=True)
class Params:
    presentation: Presentation = field(default_factory=Presentation)
    collection: Collection = field(default_factory=Collection)
    selection: Selection = field(default_factory=Selection)
    discovery: Discovery = field(default_factory=Discovery)
    baseline: Baseline = field(default_factory=Baseline)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Params":
        """Layer a TOML file over the defaults. Anything omitted keeps its default."""
        if path is None:
            return cls()
        data = tomllib.loads(Path(path).read_text())
        hyper = _section(data, "hyper", dict)
        return cls(
            presentation=_build(Presentation, _section(data, "presentation", dict),
                                "presentation"),
            collection=_build(Collection, _section(data, "collection", dict),
                              "collection"),
            selection=_build(Selection, _section(hyper, "selection", dict),
                             "hyper.selection"),
            discovery=_build(Discovery, _section(hyper, "discovery", dict),
                             "hyper.discovery"),
            baseline=_build(Baseline, _section(hyper, "baseline", dict),
                            "hyper.baseline"),
        )

    def replace(self, **sections) -> "Params":
        """A copy with some values changed: `p.replace(selection={"gain_floor": 0.1})`.

        What a sweep calls between runs, and what the parity harness uses to
        generate the configurations it compares.
        """
        updated = {}
        for name, changes in sections.items():
            current = getattr(self, name)
            _check_keys(type(current), changes, name)
            updated[name] = replace(current, **changes)
        return replace(self, **updated)


    def to_toml(self) -> str:
        """The whole configuration as TOML, defaults included.

        Written from the dataclasses rather than maintained by hand, so the
        example file cannot drift from what the code actually reads. Also what
        a sweep records beside its results, and what the contract's provenance
        block carries.
        """
        out = []
        for section, label in (("presentation", "presentation"),
                               ("collection", "collection"),
                               ("selection", "hyper.selection"),
                               ("discovery", "hyper.discovery"),
                               ("baseline", "hyper.baseline")):
            out.append(f"[{label}]")
            for f in fields(getattr(self, section)):
                out.append(f"{f.name} = {_toml_value(getattr(getattr(self, section), f.name))}")
            out.append("")
        return "\n".join(out)


def _toml_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return '"' + value.replace('"', '\\"') + '"'
    if isinstance(value, dict):
        inner = ", ".join(f'"{k}" = {_toml_value(v)}' for k, v in value.items())
        return "{" + inner + "}"
    if isinstance(value, (tuple, list)):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    if value is None:
        return "0"          # open-ended upper bound; see Collection.columns
    return repr(value)


def _section(data: dict, name: str, kind) -> dict:
    value = data.get(name, {})
    if not isinstance(value, kind):
        raise ValueError(f"[{name}] must be a table, got {type(value).__name__}")
    return value


def _check_keys(cls, values: dict, label: str) -> None:
    """Refuse unknown keys. A typo in a sweep config must fail, not do nothing."""
    known = {f.name for f in fields(cls)}
    unknown = set(values) - known
    if unknown:
        raise ValueError(
            f"unknown key(s) in [{label}]: {', '.join(sorted(unknown))}. "
            f"Known: {', '.join(sorted(known))}"
        )


def _build(cls, values: dict, label: str):
    _check_keys(cls, values, label)
    # TOML has no tuples, and frozen dataclasses want hashable defaults.
    coerced = {k: tuple(v) if isinstance(v, list) else v for k, v in values.items()}
    if "player_columns" in coerced:
        coerced["player_columns"] = tuple(
            tuple(c) if isinstance(c, list) else c for c in coerced["player_columns"])
        for col in coerced["player_columns"]:
            if len(col) != 3:
                raise ValueError(
                    f"player_columns entries are [label, lo, hi]; got {list(col)}. "
                    "Use 0 for hi to mean open-ended.")
    return cls(**coerced)


#: The defaults, built once. Modules take this when no explicit params are given,
#: so every existing call site keeps working unchanged.
DEFAULTS = Params()
