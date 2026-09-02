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
  `web/test/ui.test.js` fails any JSX `style={{…}}` that sets a margin, padding
  or offset — computed geometry is still fine, because a grid's template depends
  on how many columns there are and a bar's width is the number it is drawing.
- **Monochrome by default.** Colour is a state, never a category. There is one
  accent and it means *this is yours*. It used to mean a quantity as well — how
  much of its shelf a game carried — and that reading went with the share bar it
  coloured. Genre never gets a colour: six ways of grouping the axes were tried
  and none held, so hue would be labelling something that is not there.
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
`chart/`, `views/`, plus a few flat helpers — `shelved.js` is the only place
that answers "what is on the shelves, and where", which was written out
seven different ways before it existed. `GameItem` has three variants over one view model
(`game/view.js`) — do not add a fourth way to draw a game. There was a fourth,
`expanded`, and nothing but its own test ever rendered it: `views/Game.jsx` is
the detail view it was meant to head, and it builds its own header because it
needs labelled verbs including "I own this" where a row carries two icons.

**One renderer per idea, at sizes.** `views/Cell.jsx` is the only thing that
draws a shelf: `mini` in a grid, `full` when you open one. The unsplit screen is
one `Cell` at `full`, so it *is* a 1×1 grid rather than resembling one. Before
this, `Collection` branched on `axes.length === 0` and `Board` branched twice
more — four renderings of "the games on a shelf".

**Controls belong to the thing you opened — with one exception, asked for.**
The style guide's line is *"a control owns each variable"*, and the grid once
broke it badly: a filled two-axis board carried **110 controls, seventy of them
the same stepper repeated once per cell**. Moving the stepper into the shelf you
open took that to 65.

The per-cell stepper is **back on the grid on request**, and what a shelf would
take next came with it — also on request, also per cell. Measured on a filled
two-axis board, counting every button, input and click target on the page: 562
with the deck folded away, **597 once every cell carries its own toggle**, and
**1,007 with all thirty-five decks open**. The list is mounted only while it is
open, which is the whole difference between +35 and +445.

What makes that survivable is the change that came with the stepper: a game in
a mini cell is no longer its own click target, so a cell is one target plus the
three things in its foot — stepper, deck toggle, expander — rather than six
competing ones. If the board starts reading as a toolbar again, the stepper is
still the first thing to take back out, and the note in `views/Cell.jsx` says so
at the call site.

**A cell has no header; it has a foot.** Both sizes used to open with a bar
carrying the name, the count and every control the shelf had. What is left at
the top is the shelf's *name*, and only where a shelf needs one to be found — a
stacked list, and a shelf you have opened; in a matrix the row and the column
already say which shelf a cell is, so `Board` passes `showName={false}` and the
cell has no top strip at all. Everything that changes the shelf sits under the
games instead: the count, the stepper, the depth field at `full`, and one
toggle for what the shelf would take next. The games take the slack
(`.main { flex: 1 }`) so that a grid row, which stretches every cell to the
height of its tallest, still lands every foot on one line — the head this
replaces got that alignment for free and a foot has to earn it.

**A game is its own target only on a shelf you have opened.** `mini` gives the
click to the shelf; `full` and the rail's `reason` rows give it to the game.

**BoardGameGeek is reached from the board game view and nowhere else.** One link,
on the one surface that is about a single game — a link on every row of every
shelf is forty ways out of a page nobody asked to leave. The url is spelled once,
on the view model (`game/view.js`), never at a call site. The games that view
names under "Games like it" open as board game views of their own, carrying
`state.focus` as `from` so back walks the chain that was clicked.

**One overlay, and the thing you clicked is its subject** (`primitives/Overlay`,
`views/Focus.jsx`). A shelf or a game — never two stacked, which is the guide's
*"avoid nested panels"*. It used to offer a third subject, the whole collection,
and nothing ever opened it: the unsplit screen already *is* the collection at
full size, so the overlay had nothing to add. Asked directly, the guide says nothing at
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
- **A finding rolled up across a grid is measured on one shelf, and must name
  it.** A shelf is the scale a reader can act on and the scale these measures
  mean anything at; a figure averaged over 272 games is a column of zeros. The
  shelf used to be attached to the finding and then dropped by the renderer, so
  the reader got a number with nothing to attach it to.
- **Do not report a share of the coverage space to a reader.** It is a
  percentage of something they have never been shown, so there is nothing to do
  with it. `contributions` and `prunable` said "this game holds 3%" and "these
  three together hold 12.9% against Final Girl's 11.4%", and both are deleted
  along with the per-game share bar. The radar is the sanctioned way to show
  coverage, because it shows a shape and names the kinds in words. See BUGS.md
  for what the rail still needs to answer.
- **"Nothing to report" is the right answer on a collection nobody uploaded.**
  The closest pair in the recommended collection sits at **0.44** similarity; a
  real duplicate (Gloomhaven / Jaws of the Lion) sits at **0.95**. The old
  "held twice" reading 0 findings was correct, not broken. `analysis/gaps.jsx`
  reports gaps *and* duplicates; both name a game, which is the line that module
  holds to.
- **`built.data` and `built.filled` are non-enumerable on purpose.** Each is a
  whole extra build behind a getter, and spreading an object *invokes* its
  getters — `{ ...built, mineOnly }` in a standfirst ran a second `buildGrid` on
  every render. Measured: 699 of the 734 scoring passes behind one click came
  from `get filled`, and blocking a game cost 586 ms against 133 ms once it was
  gone. Never re-add a lazy getter as an enumerable property.
- **A percentage is drawn against 100%, never against the longest bar beside
  it.** A share already has a length before anybody picks a scale, and the
  number printed next to the bar has to agree with the bar. `Bars` enforces it:
  pass `percent` and the scale is 1. A quantity that is *not* already a share
  still needs a scale from its own data, which is what `max` is for — a game's
  axis loadings sum to 1, so they take `max={1}`. The shelf's share bar got this
  wrong twice in opposite directions before it was deleted: first at
  `min(100, share * 1000)%`, which clamped every bar to full, then normalised to
  the biggest share on the same shelf, which made the top game of every shelf a
  full bar labelled 14%.
- **A shelf is drawn the way the collection is, over a smaller population.**
  One shape, no overlay — how far the games it holds reach into each of the
  twelve families, out of everything there is to reach. What changes for a shelf
  is *what there is to reach*: it can only ever hold games passing its
  player-count and weight constraints, so that pool is the denominator, not the
  corpus. `built.cells` are the pools. Measured, the same shelf of eight reads
  0.069 against the corpus and 0.151 against its own pool — 23% of the radius
  against 35%. It is still not a full shape and should not be: eight games
  genuinely reach about a seventh of what the two hundred that qualify there do.
  Costs 10 ms across all 35 shelves.
- **A shape carries its own note.** The view used to choose between two
  sentences about the collection, which were the wrong sentences the moment
  anything else was being drawn.
- **The radar says which claim it is making.** "Reaches no Deduction" and
  "thinnest on Deduction" are different statements; the first was being printed
  for a spoke sitting at 0.12. A spoke under 0.005 is unreached, anything else
  is thin.
- **`size` on the radar is its coordinate space, not its rendered size.** The
  svg is `width: 100%`, so it grows to whatever holds it — 300px in the rail and
  700px in an overlay. Cap the container, do not change `size`.
- **A spinner cannot be started when the work starts.** `buildGrid` is one long
  synchronous task on the render thread, so nothing paints while it runs. The
  rebuild-triggering actions go through `useTransition` in `ui/state.js`, which
  makes React paint the current tree with `pending` true *before* it begins the
  render that blocks. Only those actions: opening a shelf or a panel changes no
  numbers, and putting them behind a transition makes the cheap half of the
  interface feel like the expensive half. `mount.test.js` asserts the sequence
  deliberately *outside* `act`, since `act` flushes the transition away.
- **The bar mounts at once and shows itself after `--wait`.** It has to be
  mounted the moment work starts, because the thread is about to block and
  nothing can mount it later — but showing it for a 24 ms rebuild turned every
  button press into a blink. The delay is a compositor animation on opacity,
  which keeps running while the render thread is busy; a timer would not, since
  the thread is exactly what is busy. Nothing dims the view: what is on screen
  is still true, it is only about to be replaced.
- **`COLLECTION_PROBE` is how deep the curve is read, not a ceiling.** It used
  to be both, so asking the unsplit collection for more than 120 games gave 120
  while the control kept saying the number you typed.
- **`repair` scores each cell once per pass.** It used to rescore a cell inside
  the loop over that cell's own picks, and again per cell compared against, so a
  shelf of twenty rescored itself twenty times over. At a 5% returns bar that was
  15,161 scoring passes against 452 at the default and **72 seconds** for one
  rebuild — a frozen tab, reported as a crash. Cached per pass it is 4.7s, and
  the cache is only safe because a move ends the pass.
- **One space: the 77 axes, weighted.** Every measurement — picking, gaps,
  contribution, pruning — runs on the raw axes through `covers`/`totalOf` in
  `engine/shelf.js`. The 12 spokes survive only to *name families to a reader*
  and to draw the radar, which projects the axis coverage into twelve places
  rather than measuring them. Two spaces is how Navegador came out 96%
  duplicated at 0.00 similarity, and how one game read 0.15% where the selector
  had it at 1.86%.
- **An axis is worth `coverage.axis_weights`, not 1.** Every spoke carries an
  equal share and its axes divide that share by reach, so a family does not get
  more say for having been cut into more pieces by the clustering — counting
  each axis as 1 gave Area Majority (15 axes) five times the vote of Tile
  Placement (3). The weights are computed once in the pipeline and **published
  per dimension**; the interface reads them rather than recomputing, because
  both engines must read the same rounded number.
- **They average 1, they do not sum to 1.** Ranking cannot see an overall scale
  but `gain_floor` can, and so can the gains shown to a reader. Normalising to
  sum 1 divided every gain by 77 and the parity case that sets a gain floor went
  from 147 picks to 0.
- **A duplicate and a redundancy are different questions.** A duplicate is the
  same game twice — a lookup against what BGG publishes (`kin` is `reimplements`,
  `thin` is a same-family subset), binary because identity is. A redundancy is
  how little of a shelf would be lost without a game — a quantity, reported as a
  gradient with no threshold — and one nobody could act on, so the measure that
  reported it is deleted. `redundancies` in `engine/shelf.js` is the duplicate
  half and stays. **No threshold on likeness can do the duplicate job**:
  7 Wonders and its second edition score 0.79 on similarity, below any floor that
  also excludes Navegador / Orléans — which spoke containment read as 96%
  duplicated and the selector, on the raw axes, correctly reads as 0.00.
  `REDUNDANCY_FLOOR` is deleted; do not reintroduce one.
- **Coverage loss is superadditive, so a set must be costed as a set.** Two games
  covering the same ground each cost almost nothing alone and a great deal
  together, so summing per-game shares understates it every time. `prunable` did
  this correctly and was deleted anyway — the maths was never the problem, the
  sentence it produced was. Anything that costs a set later needs this property
  back.
- **The cell is the objective; the collection is a tiebreak.** The scorer applies
  the shelf's similarity penalty at full strength and the collection's raised to
  `COLLECTION_WEIGHT = 0.10`. At 0.80 similarity that is a 51% cost on your own
  shelf against 7% elsewhere, collapsing to zero only at 1.0. This is deliberate.
- **The radar draws `radius × √coverage`**, so equal coverage covers equal area.
  Drawing it linearly made a fixed gain invisible near the middle and large near
  the edge: tracking the model's own gain 0.09 against 0.50, worst distortion 92×
  against 8.6×. √1 = 1, so full still looks full.
- **Never show a reader a raw coverage difference.** A shelf holding none of a
  kind the collection covers fully rendered as "Deduction −1.00", a number on a
  scale nobody was shown. The radar names the kinds in words instead.
- **A game's axis loadings sum to exactly 1.0**, so they are already shares of
  what the game is. `chart/Bars.jsx` must be given `max={1}` for them: scaling
  to the row maximum made every game's top axis full width and drew a game that
  is a bit of everything as a solid block.
- BGG publishes no price, no box dimensions and — in this capture — no
  description. Features that need them are blocked on data, not on design.
