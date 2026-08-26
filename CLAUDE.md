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
- **Reflow before shrinking; never truncate.** The guide is explicit here where
  it is silent on overlays: *"reflow before shrinking, preserve readable type"*,
  *"do not conceal page overflow, give grid and flex children `min-width: 0`"*,
  and local scrolling only *"when reordering and simplification cannot preserve
  lookup"*. Measured on the seven-column board, the room a game's name gets: 17
  characters at 1440px, 13 at 1280, 7 at 1024, 4 at 900, and at 768 and below
  the board is narrower than its own row heads and add strip, so columns resolve
  to zero. So the rail reflows under the board below 1200px, and the matrix
  becomes a list of shelves below 900px (`ui/useMedia.js`). A stacked shelf keeps
  its own name, so lookup survives and sideways scrolling is not needed.
- **Geist and Geist Mono**, from Google Fonts, with real fallback stacks.

`web/src/ui/` is the whole interface: `tokens.css`, `primitives/`, `game/`,
`chart/`, `views/`. `GameItem` has four variants over one view model
(`game/view.js`) — do not add a fifth way to draw a game.

**One renderer per idea, at sizes.** `views/Cell.jsx` is the only thing that
draws a shelf: `mini` in a grid, `full` when you open one. The unsplit screen is
one `Cell` at `full`, so it *is* a 1×1 grid rather than resembling one. Before
this, `Collection` branched on `axes.length === 0` and `Board` branched twice
more — four renderings of "the games on a shelf".

**Controls belong to the thing you opened, not to every thing.** Counted on the
shipped corpus, a filled two-axis grid carried **110 controls, seventy of them
the same stepper once per cell**; it is 74 now and none of them are steppers.
The style guide's line is *"a control owns each variable"* — thirty-five copies
of one control is one variable shown thirty-five times.

**One overlay, and the thing you clicked is its subject** (`primitives/Overlay`,
`views/Focus.jsx`). A shelf, a game or the collection — never two stacked, which
is the guide's *"avoid nested panels"*. Asked directly, the guide says nothing at
all about drawers, modals or sheets; do not attribute a placement rule to it.

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
- **Splitting deals the collection out; it never re-chooses it.** Turning on an
  axis hands `buildGrid` the games already shelved (`held`, plus `heldAt` for
  where each one sat) and every shelf takes what it was dealt. Fitting is a
  separate act with its own button, and it runs in **both** directions: dropping
  a band packs the same games into 28 shelves instead of 35, leaving six of them
  holding 52 games *more* than they read. A prompt that counts only the
  shortfall goes silent exactly when the grid is most out of shape, which is
  what "dropping a row offers no way to refit" was.
  Splitting twelve games used to put fifty-
  eight on the screen, forty-seven of them strangers; it is 0 in and 0 out now,
  and the rebuild is 58 ms against 415 ms because the allocator has nothing left
  to decide.
- **A fit trims by score, never by position.** `filled` runs two passes: the
  first confines the corpus to what you hold (`confineTo`, which unlike
  `include` leaves the genre rating spans alone) and lets every shelf take its
  best; the second tops up from the whole corpus. Slicing the dealt list
  instead cut whatever sat at the end, and a game that had just been re-homed
  always sat at the end — drop the band holding Gloomhaven and the refit
  deleted it. The invariant is that a fit gives the same answer whichever order
  it was handed the games, and `shelf.test.js` asserts it by reversing them.
- **A fit re-optimises, it does not only trim.** Games move shelf: 3 of 12 on a
  freshly split grid, 61 of 213 after a band is dropped. Games from a dropped
  band survive a fit at 52% against 87% for everything else — they are the
  surplus that has to give way, not a bug.
- **`heldAt` is a Map, and it has to be.** Game ids are numbers, so a plain
  object stringifies them and every lookup misses silently. Dealing by belonging
  alone — `seedInto` rather than `dealInto` — moved 101 of 272 games, so the
  grid settled and then jumped.
- **Depth is a guide at four levels and a ceiling at none**: cell, then column
  or row, then the register, then the reading. A typed axis takes its cells out
  of the register's reach. The register used to *replace* the column-and-row
  layer, so typing 9 on a column did nothing whenever a register value was set.
- **There is no `auto` tag**, and nothing should reintroduce one. A number a
  reader typed and a number a shelf read are the same kind of thing to look at;
  labelling one of them was the most confusing thing on the screen.
- **Row identity is not broken — do not "fix" it.** Measured: blocking one game
  on a 98-row grid keeps 96 of 98 DOM nodes and rebuilds none. What was missing
  was any way to *see* which two changed, which is what `ui/useChanges.js` and
  the `came`/`went` states on `GameItem` are for.
- `held` is interface state, not a model parameter: `pipeline/` has no deal and
  no fill, so parity covers selection and not this. `per_shelf_cap` *is*
  mirrored, and has a golden case.
- Pinning a game that already holds a place is a no-op. Only pins that *lost* are
  seeded, and the seed set accumulates until every pin is in.
- The grid is the collection with axes applied. `buildCells(ix, { axes: [] })` is
  one cell holding everything, which is where the twelve-game collection comes
  from. There is no separate "aggregate" object.
- Axis names are compound (`Paper-and-Pencil · Bingo · Simultaneous Action
  Selection`). Take the first segment for a label.
- **An analysis is scoped by its `subject`, never by reading the state.** The
  rail describes the page, an opened shelf describes that shelf, and both render
  at once. `analyse({ built, state, subject })`.
- **Shelf scale is the only scale these measures work at.** Across 272 games
  every game's unique share reads **0.0000** — saturation, the same failure the
  radar has — while every shelf of three or more spreads 15% down to 4%.
  Collection-level findings are per-shelf results rolled up and named by shelf.
- **"Nothing to report" is the right answer on a collection nobody uploaded.**
  The closest pair in the recommended collection sits at **0.44** similarity; a
  real duplicate (Gloomhaven / Jaws of the Lion) sits at **0.95**. The old
  "held twice" reading 0 findings was correct, not broken — what was missing was
  the other half, which is why `analysis/gaps.jsx` reports gaps *and*
  redundancies. It has something to say on 30 of 30 shelves, against 3 of 30.
- **`built.data` and `built.filled` are non-enumerable on purpose.** Each is a
  whole extra build behind a getter, and spreading an object *invokes* its
  getters — `{ ...built, mineOnly }` in a standfirst ran a second `buildGrid` on
  every render. Measured: 699 of the 734 scoring passes behind one click came
  from `get filled`, and blocking a game cost 586 ms against 133 ms once it was
  gone. Never re-add a lazy getter as an enumerable property.
- **A game's axis loadings sum to exactly 1.0**, so they are already shares of
  what the game is. `chart/Bars.jsx` must be given `max={1}` for them: scaling
  to the row maximum made every game's top axis full width and drew a game that
  is a bit of everything as a solid block.
- BGG publishes no price, no box dimensions and — in this capture — no
  description. Features that need them are blocked on data, not on design.
