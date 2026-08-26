"""Golden results for the JS engine to be measured against.

The allocator exists twice now — once in Python and once in JavaScript — because
selection has to re-run in the browser while the model stays offline. Two
implementations of one formula drift, and this repo already carries that risk
once: `web/src/coverage.js` mirrored `coverage.axis_coverage` held together by
nothing but a comment.

So the port is only defensible with a harness that fails when they disagree.
This writes one contract and a set of configurations with the picks Python makes
for each; `web/test/parity.test.js` runs the JS engine over the same inputs and
asserts the same games in the same order.

Everything runs on the seed dataset, because a fresh clone can reproduce it.

    python -m tests.parity.generate
"""

import json
from pathlib import Path

from pipeline import buckets, dataset, depth
from pipeline.assign import CoverageScorer, allocate
from pipeline.contract import PLACES, QuantisedSpace, build_contract, quantise_games
from pipeline.contract import write as write_contract
from pipeline.features import build_feature_space
from pipeline.params import Params

HERE = Path(__file__).parent
MERGED = [("1-2", 1, 2), ("3-4", 3, 4), ("5+", 5, 0)]

#: Each case names what it exercises, because a failure should say which part of
#: the engine disagreed rather than merely that something did.
CASES = [
    {"name": "defaults", "params": {}, "options": {}},
    {"name": "shallower cells",
     "params": {"collection": {"picks_per_cell": 3, "auto_depth": False}},
     "options": {"capacity": 3}},
    {"name": "gain floor trims thin cells",
     "params": {"selection": {"gain_floor": 0.2},
                "collection": {"auto_depth": False}},
     "options": {"gainFloor": 0.2, "capacity": 5}},
    {"name": "fewer weight rows", "params": {"collection": {"weight_rows": 3}},
     "options": {"rowCount": 3}},
    {"name": "merged player columns",
     "params": {"collection": {"player_columns": tuple(MERGED)}},
     "options": {"columns": [{"label": l, "lo": lo, "hi": hi or None}
                             for l, lo, hi in MERGED]}},
    {"name": "per-column capacity",
     "params": {"collection": {"picks_per_column": {"8+": 2, "6-8": 3},
                               "auto_depth": False}},
     "options": {}},          # capacity map filled in below
    {"name": "duplicate suppression relaxed",
     "params": {"selection": {"similarity_exponent": 2}},
     "options": {"policy": {"similarityExponent": 2}}},
    {"name": "collection pull off",
     "params": {"selection": {"collection_weight": 0.0}},
     "options": {"policy": {"collectionWeight": 0.0}}},
    # Auto depth is the default on both sides, so the case worth pinning is the
    # other one: a reader who typed a number over it.
    {"name": "one depth everywhere, set by hand",
     "params": {"collection": {"auto_depth": False}},
     "options": {"capacity": 5}},
    # Unit cost, so a budget of 60 is a collection of 60 games. The point of
    # pinning it is that the *same* 60 come out on both sides.
    {"name": "a budget of sixty", "params": {}, "options": {"budget": 60},
     "budget": 60},
    # The register is a guide, not a ceiling: a column the reader typed keeps its
    # own number while every other column takes the register's. This used to be
    # unreachable on the Python side and silently ignored on the JS side.
    {"name": "register set, one column typed over", "params": {},
     "options": {"perShelfCap": 4, "depthOverrides": {"column:3": 9}},
     "perShelfCap": 4, "overrides": {"column:3": 9}},
    {"name": "one game per kind off",
     "params": {"selection": {"genre_repeat_penalty": 1.0}},
     "options": {"policy": {"repeatPenalty": 1.0}}},
]


def run(games, space, params, banned=(), keepers=(), budget=None,
        per_shelf_cap=None, overrides=None):
    sel, coll, pres = params.selection, params.collection, params.presentation
    rows = buckets.build_weight_rows([g.weight for g in games], coll.weight_rows)
    cells, memb = buckets.build_cells(
        games, [buckets.PlayerCountAxis(coll.columns(), sel, places=PLACES),
                buckets.WeightAxis(rows, sel)], sel)
    scorer = CoverageScorer(space.loadings, space.similarity,
                            {g.id: g.rating for g in games}, space.spoke_of, sel,
                            coll.axis_room(space.dimension_names, space.spoke_of))
    by_id = {g.id: g for g in games}
    reach = {}
    for (key, gid), degree in memb.items():
        reach.setdefault(gid, {})[key] = degree

    def seed_for(missing):
        out = {}
        for gid in missing:
            here = reach.get(gid)
            if here:
                out.setdefault(max(sorted(here), key=here.get), []).append(by_id[gid])
        return out
    if coll.auto_depth:
        room = depth.grid_depths(
            games, space, {g.id: g.rating for g in games}, sel, coll, rows,
            axis_room=coll.axis_room(space.dimension_names, space.spoke_of),
            column_axis=buckets.PlayerCountAxis(coll.columns(), sel, places=PLACES),
            row_axis=buckets.WeightAxis(rows, sel),
            overrides=overrides, per_shelf_cap=per_shelf_cap)["capacity"]
    else:
        room = coll.capacity(cells)
    # Seed only the pins that lost. Seeding one up front takes it out of
    # contention for every other cell, so pinning a game that was already the
    # first pick of its shelf used to change three games and move seven — when
    # it was already staying. See web/src/engine/index.js, which does the same.
    def go(seeded):
        return allocate(cells, memb, scorer, room, seeded=seeded,
                        alternates_limit=pres.alternates_per_cell,
                        sel=sel, rejected=set(banned), budget=budget)

    results = go({})
    if keepers:
        # Seeding one pin can displace another, so accumulate until every pin is
        # in or a pass stops adding to the set. See web/src/engine/index.js.
        seed: set = set()
        for _ in range(len(keepers) + 1):
            shelved = {a.game.id for r in results.values() for a in r.assignments}
            missing = [gid for gid in keepers if gid not in shelved and gid not in seed]
            if not missing:
                break
            seed.update(missing)
            results = go(seed_for(seed))
    return {f"{k[0]}|{k[1]}": [a.game.id for a in r.assignments]
            for k, r in results.items()}


def main() -> None:
    _, generated_at, exact = dataset.load_dataset("data/games.seed.json")
    base = Params()
    # Run Python on precisely what the contract carries. Otherwise the harness
    # asks the browser to reproduce numbers it was never given: two candidates
    # 1e-5 apart are decided by precision that only one side can see, and the
    # failure looks like a logic bug when it is arithmetic neither engine got
    # wrong.
    games = quantise_games(exact)
    space = QuantisedSpace(build_feature_space(exact, base))

    write_contract(build_contract(games, space, None, "seed", generated_at, base),
                   HERE / "seed-contract.json")

    shelved = list(run(games, space, base))
    top = sorted(games, key=lambda g: g.rank)
    banned = [g.id for g in top[:3]]
    keepers = [g.id for g in top[400:403]]

    cases = list(CASES) + [
        {"name": "banned games", "params": {}, "options": {"banned": banned},
         "banned": banned},
        {"name": "keepers pinned", "params": {}, "options": {"keepers": keepers},
         "keepers": keepers},
        {"name": "genre discounted to zero",
         "params": {"collection": {"genre_weights": {space.dimension_names[9]: 0.0}}},
         "options": {"genreWeights": {9: 0.0}}},
    ]

    out = []
    for case in cases:
        params = base
        for section, changes in case.get("params", {}).items():
            params = params.replace(**{section: changes})
        options = dict(case["options"])
        if case["name"] == "per-column capacity":
            options["capacity"] = {
                k: v for k, v in params.collection.capacity(
                    [(c["label"], str(r)) for c in params.collection.columns()
                     for r in range(params.collection.weight_rows)]).items()
            }
            options["capacity"] = {f"{k[0]}|{k[1]}": v for k, v in options["capacity"].items()}
        picks = run(games, space, params,
                    banned=case.get("banned", ()), keepers=case.get("keepers", ()),
                    budget=case.get("budget"),
                    per_shelf_cap=case.get("perShelfCap"),
                    overrides=case.get("overrides"))
        out.append({"name": case["name"], "options": options, "picks": picks})
        print(f"  {case['name']:<32} {sum(len(v) for v in picks.values()):>3} picks")

    (HERE / "golden.json").write_text(json.dumps(out, indent=1))
    print(f"Wrote {len(out)} cases to {HERE.name}/golden.json")


if __name__ == "__main__":
    main()
