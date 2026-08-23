# Working in this repo

Read `README.md` for what the thing is. This file is how to change it.

## The interface follows a style guide

**<https://vercel.com/design.md> — adopt the system, own the brand.** Its
structure is the rule here; its identity is not. Vercel's own palette and
wordmark are theirs, and this is a tool for looking at board games.

What that means in practice, all of it already built and all of it enforced:

- **Semantic tokens, never literals.** Every colour, space and radius lives in
  `web/src/ui/tokens.css`. A `.module.css` under `ui/` that writes a hex value
  fails `web/test/ui.test.js`. This rule exists because the stylesheet it
  replaced invented `--ink`, `--panel` and `--line`, none of which were ever
  defined, and rendered black on black in eighteen declarations.
- **Type by role, not by size.** display / title / heading / body / label /
  numeral / metadata. Numerals are `--font-mono` with `tabular-nums` wherever
  digits line up.
- **One owner per gap.** Layout sets spacing with flex or grid `gap`; components
  never add margins to position themselves. A `Panel` owns its own padding.
- **Monochrome by default.** Colour is a quantity or a state, never a category.
  There is one accent, and it means *how much a game carries*. Genre never gets
  a colour: six ways of grouping the axes were tried and none held, so hue would
  be labelling something that is not there.
- **Direct labels over legends.** Name the thing on the thing.
- **Geist and Geist Mono**, from Google Fonts, with real fallback stacks.

`web/src/ui/` is the whole interface: `tokens.css`, `primitives/`, `game/`,
`chart/`, `views/`. `GameItem` has four variants over one view model
(`game/view.js`) — do not add a fifth way to draw a game.

## Two verbs, and they are the same everywhere

**Pin** holds a game whatever the selection would rather do. **Block** takes it
out of the running. One icon each, same order, in a table row, in a grid cell
and in the drawer. The surface this replaced had own/lock/keep/anchor/ban across
five files with three meanings for "keep".

## How to change the model

**Measure before asserting.** Every strong claim in this repo's history that was
not measured turned out wrong: that discovery was the bottleneck (allocation was
16× slower), that `QUALITY_FLOOR` was redundant (removing it costs genre
spread), that the spoke containment measure found duplicates (it read two games
with 0.00 similarity as 98% duplicated). Run it, then say it.

**Report the four numbers.** `python -m pipeline.build --report` prints cohesion,
name-truth, pick quality and slots filled. Any change that touches selection or
the feature space reports all four in its commit body. A change that improves one
and quietly costs another is described that way.

**No hyperparameter is hardcoded.** Every magnitude that changes behaviour lives
in `pipeline/config.py` with the measurement that chose it, and reaches the code
through `pipeline/params.py`. Three tiers — presentation, collection, hyper — and
they say who a value belongs to. A number that matters and is not in that file is
a bug.

**Both engines agree.** `pipeline/` and `web/src/engine/` implement the same
formulas; `tests/parity/generate.py` and `web/test/parity.test.js` assert the same
picks in the same order across fourteen configurations. Change one side, mirror
it, regenerate the goldens — never patch them by hand. Both sides read the
*quantised* numbers the contract carries.

**The contract carries resolved quantities, never the knobs behind them.**
`policy` is what the interface applies and never shows; `defaults` is what a
reader may change.

## How to know it works

- `cd web && npm test` — engine, parity, interface, and a real DOM.
- `python -m pytest tests -q`
- `web/test/mount.test.js` mounts the app in jsdom and clicks it. Server
  rendering proves a component does not throw on the way in; it never runs an
  effect, a portal or a click handler, and every interface bug this project has
  shipped was in one of those.
- A two-split `buildGrid` has a **250 ms budget**, asserted. Every click rebuilds
  — a split, a depth, a pin, a block — so this is the only thing between a bigger
  corpus and an app that stutters.
- `npm run build` writes `docs/`, which is what GitHub Pages serves. Rebuild it
  before saying the site is updated.

## Things that are true and easy to get wrong

- A shelf's depth is read from its axis's own curve and **cached on the axis
  alone**. Blocking a game changes which games fill the shelves, never how many.
- Pinning a game that already holds a place is a no-op. Only pins that *lost* are
  seeded, and the seed set accumulates until every pin is in.
- The grid is the collection with axes applied. `buildCells(ix, { axes: [] })` is
  one cell holding everything, which is where the twelve-game collection comes
  from. There is no separate "aggregate" object.
- Axis names are compound (`Paper-and-Pencil · Bingo · Simultaneous Action
  Selection`). Take the first segment for a label.
- BGG publishes no price, no box dimensions and — in this capture — no
  description. Features that need them are blocked on data, not on design.
