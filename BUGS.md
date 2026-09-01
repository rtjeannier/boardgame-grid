# Known bugs

Six defects reported from use on 2026-08-26, each traced to a mechanism in the
code before being written down. **All six are fixed as of 2026-08-27**; each
entry keeps its diagnosis and ends with what changed and the test that now holds
it, because the mechanism is the part worth not re-deriving.

This file follows the repo's own rule — measure before asserting — so every
claim below was checked against the source, and the one claim that could not be
reproduced from the reported steps says so.

B1–B3 were self-contained. **B4, B5 and B6 were one defect wearing three
faces:** state added on one transition and never removed on its inverse. `held`
grew on a pin and on a split and shrank only on a block; `depthOverrides` grew
when a number was typed and shrank only on an explicit clear. The report's own
words — "things get in a broken state when I add and remove things back" — were
the accurate description.

---

## B1 — every bar chart draws as a grey box

**Reported:** the bar charts don't populate; just a grey box, which makes it
hard to see what they are for.

**Repro:** open any game (`Game.jsx` axis bars), or read the rail's "How much
each game holds on its own". Every bar is an empty track at every value.

**Cause.** `web/src/ui/chart/Bars.module.css:6` sets

```css
.fill { height: 100%; border-radius: var(--r-sm); background: var(--text-2); }
```

and never sets `display`. `.track` is a direct child of the `display: grid`
`.row`, so it is blockified. `.fill` is a *descendant* of the track, not a grid
item, so blockification does not reach it and it stays a plain inline `<span>`.
`width` and `height` do not apply to non-replaced inline elements, so both the
stylesheet's `height: 100%` and the inline `style={{ width: 'N%' }}` at
`web/src/ui/chart/Bars.jsx:29-30` are discarded. The fill box is zero-sized and
nothing paints over the `--sunken` track.

The same shape repeats in the shelf "carries" bar —
`web/src/ui/game/GameItem.module.css:40-43`, drawn at
`web/src/ui/game/GameItem.jsx:101-108`. Present in the shipped bundle under
`docs/assets/` (`_fill_1o2sb_6{height:100%;border-radius:...;background:...}`,
no `display`), so it is not a dev-only artefact.

The guards at `Bars.jsx:19-21` are *not* what is firing — no call site passes a
missing or zero value. The data is fine; the box model is not.
`web/test/ui.test.js` asserts on returned markup, never on layout, which is why
nothing caught it.

**A fix must keep:** semantic tokens only — a literal hex under `ui/` fails
`web/test/ui.test.js`.


**Fixed.** `.fill` is `display: block` in both stylesheets. `ui.test.js` now
fails any `.fill` rule that sizes itself without leaving `display: inline` —
checked by reverting the CSS, which fails the test with the exact message.

---

## B2 — "How much each game holds on its own" says nothing

**Reported:** the list reads `A Study in Emerald (Second Edition) 2%`, `Oasis
2%`, `Cosmic Frog 2%` … with no indication of what the games refer to or where
they come from.

**Repro:** load the app unsplit or split; read the rail.

**Cause.** Two problems in one block, `web/src/ui/analysis/gaps.jsx:171-188`.

1. **The shelf name is computed and then thrown away.** `gaps.jsx:122-125`
   attaches `cell` to every entry, and the render at `gaps.jsx:177-180` uses
   only `h.name`, `h.holds`, `h.id`. The module already holds the labeller it
   needs: `label(cell)` at `gaps.jsx:140`, backed by `cellLabel` at
   `gaps.jsx:207-214` ("solo · Light", "4 players · Medium"). It is used for the
   gaps section at `gaps.jsx:153` and nowhere else.

2. **The five rows come from five different shelves and share one scale.** The
   list is a global ascending sort across every shelf, sliced to five. `holds`
   is *the fraction of one shelf's total weighted-axis coverage lost if that
   game goes* — `web/src/engine/shelf.js:200-225`, `holds: (whole - without) /
   whole`. So each `%` has a different denominator, and `Bars` is passed no
   `max`, so it draws all five against the largest of the five. The list is
   therefore three incomparable numbers on a scale nobody was shown.

The same drop applies to the duplicates reason string at `gaps.jsx:164-166`, and
the pruning paragraph at `gaps.jsx:191-198` says "of **this** shelf" while its
shelf was chosen arbitrarily as the cheapest across the grid (`gaps.jsx:134-135`)
and is never named.

At cell scope this is all correct: `web/src/ui/views/Focus.jsx:37` passes
`subject: { kind: 'cell' }`, `gaps.jsx:103-106` returns `shelf: null`, and the
overlay title already names the shelf. **Only the rail's collection scope is
wrong.**

**A fix must keep:** "direct labels over legends", and "never show a reader a
raw coverage difference".


**Fixed.** The rail now reads *one named shelf* down, the way the gap half
already picks the shelf with the widest gap and names it: the shelf holding the
thinnest game, named in the heading, with a sentence saying what the number is a
share of. All five rows share a denominator, so the bars can share a scale.
Measured on the shipped corpus, the block went from a flat column of 2% across
five shelves to 5–14% on one:

```
What each game holds on its own — 6-8 players · Heavy
How much of this shelf stops being covered if the game goes.
    5%  Medieval Merchant
    9%  Stationfall
    9%  Here I Stand
   11%  A Game of Thrones: The Board Game (Second Edition)
   14%  Dominant Species
```

The duplicates list and the pruning paragraph now name their shelf too — the
latter said "of this shelf" while naming none. `gaps.jsx` also had its own
private copy of the cell labeller, which is now the shared `cellLabeller`.

**Superseded 2026-08-27.** On the report that the finding still said nothing
worth reading, this block was removed outright rather than relabelled — see
**R1**. The half of the fix that survives is the general one: a finding rolled
up across a grid names the shelf it was measured on, which `Gaps — what is
missing` and `The same game twice` both now do, and `mount.test.js` asserts.

---

## B3 — the radar duplicates down the left rail

**Reported:** the radar chart appears over and over; the left bar starts to
duplicate. Happens when clicking and unclicking things.

**Cause.** `web/src/ui/analysis/registry.js:31-36` is a bare module-global
append with no dedupe by `id` and no way to unregister:

```js
const REGISTRY = [];
export function register(analysis) { REGISTRY.push(analysis); return analysis; }
```

Registration is an import side effect (`web/src/ui/analysis/index.js:1-8` —
"Registering is a side effect of importing, so this module is the list").
`REGISTRY` outlives every component, so any second evaluation of an analysis
module appends a second copy, and the rail then renders that analysis twice
under the **same** React key (`web/src/ui/views/Collection.jsx:185-190` keys by
`analysis.id`). Reproduced: re-running `reach.jsx` gives
`['reach','contains','gaps','over-represented','reach']`, React warns "two
children with the same key, `reach`", and the mounted radar count goes 1 → 2.
Monotonic — one more each time.

**Caveat — confirm the trigger before fixing.** Clicking alone did *not*
reproduce it: cycling the split chips 4×, opening and closing shelves 3×,
toggling "Build on mine", switching pages and owning six games all held at one
radar and 4–5 rail blocks. Three things that would have been the obvious
suspects are all innocent — `analyse()` builds a fresh array each call
(`registry.js:39-48`), no chart is registered in an effect, and
`web/src/ui/primitives/Overlay.jsx:18-28` cleans up correctly (open/close ×4
gave radar counts 1 → 2 → 1 → 2 → 1, no leak).

The one confirmed trigger is module re-evaluation. Under `npm run dev` that is
Vite HMR on every save, since no analysis module declares `import.meta.hot` —
which would make the count climb during a working session and reset on a hard
reload. **Check whether this happens on the built `docs/` site or only under
`npm run dev`.** If dev-only it is still a real defect, but not one that ships,
and that changes its priority.

Secondary, same feature: `web/src/ui/chart/Radar.jsx:121` keys wrapped label
lines by their own text (`<tspan key={line}>`), which collides if a spoke name
wraps to two identical words.


**Fixed.** `register` keys on `id`: registering the same analysis twice replaces
it rather than appending. Confirmed against the real trigger — invalidating
`reach.jsx` in Vite's module graph and re-loading it took the registry 4 → 5
before, and holds at 4 now (`mount.test.js`).

---

## B4 — unpinning does not remove a game the pin added

**Reported:** pinning a game that was not in the collection adds it, which is
right. Unpinning it does not remove it, and it should go away if the pin was the
only reason it was there.

**Repro:** pin a game not currently shelved — it appears. Unpin it — it stays,
through every subsequent split, fit and rebuild.

**Cause.** `web/src/ui/state.js:118-127`. The pin case toggles `pinned`, but
only one direction touches `held`:

```js
held: state.held == null || state.pinned.includes(action.id)
  ? state.held : [...new Set([...state.held, action.id])],
```

`state.pinned.includes(action.id)` is the **pre-toggle** read, so that branch
*is* the unpin — and it passes `held` through unchanged. Nothing anywhere else
prunes it. `case 'axis'` (`state.js:95-102`) and `case 'fill'`
(`state.js:104-107`) replace `held` wholesale with what is currently shelved,
and the stray game is still shelved, so it survives every re-deal.

Once in `held` the game is force-placed regardless of pin state: `held` becomes
the dealt map (`web/src/engine/index.js:209-231`), which is handed to `allocate`
as `seeded` (`index.js:278`), and seeded games are taken before any bidding
(`web/src/engine/allocate.js:227-239`). An unpinned-but-still-held game
therefore outranks the selection permanently.

`case 'block'` at `state.js:130-131` *does* prune `held`. That is exactly the
shape the pin case is missing.

The engine-side seed set is **not** at fault, despite looking like the culprit:
it is local to each `buildGrid` and rebuilt from `state.pinned` on every call
(`index.js:286-299`). CLAUDE.md's "the seed set accumulates until every pin is
in" describes convergence *within one build*, not persistent state. The leak is
entirely `state.held`.

**A fix must keep:** a pin is an addition, not a swap — the comment at
`state.js:114-117` records why (without it a pin landed on a full shelf and
pushed three games off). Removing on unpin must not remove a game that was
*also* independently selected, which means distinguishing "held because pinned"
from "held because chosen" — a distinction `held` does not currently carry.
Note too that `pin` never writes `heldAt`, so the added game has no recorded
cell and is placed by belonging on each deal.


**Fixed.** State carries `pinAdded`: the ids a pin put into `held` that were not
there already. An unpin removes exactly those and nothing else — a game you were
already holding, or one a later fit chose on merit, stays. `block` prunes the
same list, since there is then no addition left to undo.

One thing this deliberately does not change: on the *undealt* collection
(`held == null`, which is where the app opens) a pin is still a swap rather than
an addition — every shelf fills to its depth and the pin decides which games
fill it. That is existing behaviour and symmetric on unpin.

---

## B5 — "Fit the shelves" leaves a shelf holding 20+

**Reported:** fit doesn't seem to work; one shelf ends up with 20+ games. Occurs
when swapping between large and small counts and adding and removing split-bys.

**Cause.** Four compounding faults. The shared root: **`held` and
`depthOverrides` are never pruned when an axis goes away.**

**1. `held` ratchets.** `web/src/ui/App.jsx:104` uses one call site for both
directions (`onToggle={(key) => actions.toggleAxis(key, collectionOf(built))}`,
and `collectionOf` returns everything currently on screen). `case 'axis'`
(`state.js:95-102`) has no removed-branch: `held := the whole previous screen`.
Measured on the shipped corpus:

| step | `held` | on screen |
|---|---|---|
| perShelf = 25, unsplit | – | 25 |
| + player count | 25 | **175** |
| + weight | 175 | **802** |
| − weight | 802 | 175 |
| + weight | 175 | **800** |

**2. An "unspoken" shelf has no ceiling.** `web/src/engine/index.js:251`:

```js
const asked_ = spokenFor(c.key) ? roomFor(asked, c.key) : mine.length;
```

A shelf nobody has typed at keeps however many games the deal handed it — its
own reading is not a ceiling and is never consulted. And `spoken` is true only
while a cell override, an axis override or `perShelfCap` exists
(`web/src/engine/depth.js:240`, `spoken: set != null || typed || perShelfCap
!= null`), so **clearing the register flips every
shelf into this branch at once.** Measured: clearing `perShelf` took the worst
shelf to 17 against a reading of 9, with 10 shelves over.

Related: the register is a multiplier, not a cap — `depth.js:194-201` returns
`perShelfCap ?? reading`, making the typed number the depth of *every* shelf, so
raising it while split multiplies the collection by the shelf count before
anyone presses Fit.

**3. Stale `cell:` overrides collide across axes.** `depthOverrides` is never
pruned; `state.js:82-89` argues a stale key "simply never matches, which costs
nothing". That is false — the two single-axis grids share one flat key
namespace (`depth.js:244-248`), where a column label and a row index are both
bare strings. Measured:

```
+ players               over={}              worst={k:"2", n:5,  want:5}
type 25 on "3 players"  over={cell:3 → 25}   worst={k:"3", n:25, want:25}
− players (unsplit)     over={cell:3 → 25}   worst={k:"",  n:32}
+ weight (band 3)       over={cell:3 → 25}   worst={k:"3", n:25, want:25}   ← reappeared on the other axis
FIT                     over={cell:3 → 25}   worst={k:"3", n:25, want:25}   total 52 → 58
```

The 25 typed on the *3-players column* silently became the depth of *weight
band 3*. Two-axis keys survive a band drop and return the same way: `4|2` at 25,
total 42 → 226 after a Fit.

Also dead: nothing writes `column:` or `row:` keys any more — the only writers
are `depthKeyOf` (`web/src/ui/views/Cell.jsx:47`) and `AddNext`
(`web/src/ui/views/Collection.jsx:125`), both `cell:`. So `depthOf`'s override
branch and `typed` at `depth.js:229` cannot fire, and CLAUDE.md's "a typed axis
takes its cells out of the register's reach" is no longer true of the shipped
UI.

**4. Fit cannot see the shelves it should fix.**
`web/src/ui/views/Collection.jsx:69` measures `c.picks.length` against the
**overridden** depth, so a shelf made over-full by a stale override reads 25 =
25 and is never counted. And with the register set, every shelf sits exactly at
it, `short = over = 0`, and the whole Fit block unmounts (`Collection.jsx:73`).
Measured: `perShelf = 20` → no Fit button at all, 35 shelves of 20.

One more, from the working-tree change at `index.js:139-141`: the collection
depth is no longer clamped to `COLLECTION_PROBE`, so with `Cell`'s `PlusMinus`
writing `collection = held ± 1` off a gathered 175-game shelf, the unsplit
collection can be pinned to an arbitrary number.

**A fix must keep:** the invariants in CLAUDE.md here are load-bearing and were
each bought with a bug — a fit trims by score and never by position; `heldAt`
stays a `Map` (game ids are numbers, and a plain object misses silently); a fit
gives the same answer whichever order it was handed the games, which
`web/test/shelf.test.js` asserts by reversing them; splitting deals the
collection out and never re-chooses it. The 250 ms two-split `buildGrid` budget
is asserted.


**Fixed.** The ambiguous key is now named by its axis. With both axes on a cell
key is `"4|2"`, which reads only one way — and is the form `pipeline/depth.py`
mirrors and `tests/parity` asserts, so it is untouched. Only the single-axis
keys take a prefix: `cell:players:3` and `cell:weight:3` can no longer collide.
`column:`/`row:` keys were already distinct by prefix and are also part of the
cross-engine contract, so they are unchanged.

Measured on the reported sequence — type 25 on the 3-players column, drop
players, add weight:

```
before   + weight → band 3 holds 25, reads 25, fit[over=0]   ← fit refused to touch it
         FIT      → band 3 still 25
after    + weight → worst shelf 14, reads 9,  fit[over=2]    ← fit can see it
         FIT      → worst shelf 12, reads 12, fit[over=0]
```

The typed 25 also comes back when the reader returns to the player-count split,
which is the property `state.js` was already trying to have.

Two further faults named in the diagnosis are **not** changed, deliberately:
`asked_ = mine.length` for an unspoken shelf, and unsplitting gathering the
whole grid onto one shelf. Both are the documented "splitting deals the
collection out, it never re-chooses it" invariant — capping there would drop
games on a split, which is the bug that rule exists to prevent. They leave the
grid recoverable with one press of Fit, and after this change Fit can always see
what needs fitting.

Found while fixing it: `cellLabeller` had the *same* ambiguity, trying the
weight-band name first — so every column of a player-count-only grid was
labelled with a weight band, and the 3-players column read "Medium-Heavy". It
consults `built.axes` now.

---

## B6 — "＋ Add X" adds a different game

**Reported:** sometimes the control says add game "X", but adding it adds a
different game.

**Repro (most reliable):** unsplit, block the game the button is currently
offering. The label keeps offering it; the click adds someone else.

**Cause.** The label and the click are two different allocations.
`web/src/ui/views/Collection.jsx:125`:

```jsx
<Button onClick={() => actions.setDepth(best.key, best.depth + 1)}>
  ＋ Add {best.name}
</Button>
```

The handler **never names the game.** It raises a depth number by one and lets
the next `buildGrid` decide who fills the slot. Nothing enforces that this is
`best.name`. Two ways it diverges:

- **Unsplit:** the label is `depths.cell.nextName` (`index.js:150`, `:184`),
  which comes from `collectionCurve` (`web/src/engine/depth.js:260-274`). That
  runs its *own* allocation with **no `rejected` (blocked games), no `seeded`
  (pins or the deal), no `budget`, no `perShelfCap`** — and memoises the result
  in a `WeakMap` keyed only by `collection|probe|gainFloor|genreWeights`, so
  blocking or pinning does not invalidate it. The real build that runs after the
  click passes all of those (`index.js:272-284`).
- **Split:** `alternates[0]` is a post-hoc per-cell queue built *after*
  allocation from leftover candidates (`web/src/engine/allocate.js:298-322`).
  Raising a cell's capacity re-runs deferred-acceptance bidding across every
  cell (`allocate.js:242-262`) plus `repair` and `improveCollection`, so another
  cell can re-bid and win the new slot.

Two aggravating details in the same handler, worth fixing together:

- `best.depth` is `c.picks.length` (`Collection.jsx:114`) — what the shelf
  *holds*, not what it *reads*. On a shelf short of its depth this writes an
  override *below* the read depth.
- Writing the override flips that shelf to `spokenFor`
  (`index.js:221-224`, used at `:251`), which trims its deal. Combined with B5,
  **one press of "Add X" on a gathered unsplit collection can remove games**,
  and freezes that shelf at `picks.length + 1` for good.

Also: `state` is destructured into `AddNext` at `Collection.jsx:99` and never
used — a leftover from when the button did something id-specific.


**Fixed.** Both halves now come from one place. The name is `alternates[0]` of
the shelf offering it — the real allocation, blocks and pins included — for the
unsplit collection as well as the split grid, so `depths.cell.nextName` and its
blind, block-ignoring cached probe are out of the button entirely. And the click
adds *that id* to `held` rather than raising a depth and letting the next
allocation choose, so the two cannot disagree by construction.

Verified on the reported repro: block the offered game and the button re-offers
the real next one ("Modern Art" → "Dune: Imperium – Uprising"), and pressing it
puts that game on a shelf. `mount.test.js` now asserts the named game is the one
that arrives, not just that the count grew.

A shelf that was asked for a number is full at that number, so the ask moves up
by one with the game — otherwise the added game sits at the end of the deal and
is the first thing trimmed. That side effect of the old handler (writing an
override the reader never typed, which then froze the shelf) now only happens
where it is meaningful.

---

## B7 — blocking a game sometimes shrinks the shelf and sometimes replaces the game

**Reported:** sometimes banning a game just reduces the number of games in the
cell, other times it replaces it. Inconsistent.

**Repro:** block a game on a shelf before splitting — something takes its place.
Split (or press Fit), then block another — the shelf simply gets smaller.

**Cause.** `case 'block'` filtered the id out of `held` as well as banning it
(`web/src/ui/state.js`). A shelf nobody has typed a number at takes exactly what
it was dealt — `asked_ = mine.length` at `web/src/engine/index.js:251` — so one
fewer in `held` meant one fewer on the shelf. Undealt (`held == null`) the shelf
fills to its depth instead, so the slot was refilled; and a shelf with a number
on it fills to that number, so that was refilled too. Which of the two you got
depended on invisible state. Measured on a split grid of 50:

```
undealt, unsplit     8 -> 8    (replaced)
undealt, split      50 -> 50   (replaced)
dealt, split        50 -> 49   (shrank)     ← the inconsistency
dealt, register set 42 -> 42   (replaced)
```

**Fixed.** `held` is left alone. It is what the collection is *meant* to hold,
so the shelf goes on asking for the same number and the ban loses that one slot
to the next game — `allocate` skips a seeded game that is also rejected ("banned
wins", `allocate.js:231`) and the auction fills the gap. This also makes
unblocking symmetric: the game is still in `held` with its `heldAt`, so it goes
back where it was. It is also what the `notice` machinery already assumed —
it reports *what replaced it*, which has nothing to say if blocking only shrinks.

`mount.test.js` covers both directions; reverting the filter fails it with
`blocking took the dealt collection 8 -> 7 instead of replacing`.

---

# To rework

## R1 — the analysis rail needs an answer worth reading

**Status:** two findings removed 2026-08-27; what replaces them is open.

Removed, on the report that they said nothing a reader could act on:

- **"What each game holds on its own"** — a per-game share of one shelf's
  weighted-axis coverage, e.g. `Neko Syndicate 3%`.
- **"What a few are worth against one"** — "these three together hold 12.9% of
  this shelf; Final Girl alone holds 11.4%."
- The per-game share bar beside each game on an opened shelf, and
  `contributions` / `prunable` in `engine/shelf.js`, which were their only
  callers.

**Why they failed, which is the part worth keeping.** Both reported *a
percentage of the coverage space*. That space is real — it is what the selector
optimises — but the reader has never been shown it, so a share of it is a number
with nothing to compare against and nothing to do about. Two further problems
followed from that and are worth not repeating:

1. **The spread is genuinely small, and the old bar scale hid it.** On a real
   shelf the shares run 9.2% to 16.8%. Normalising the bars to the largest share
   manufactured a spread that is not in the data — the top game drew full width
   at 16.8% and the bottom drew at 55%. Drawn honestly against 100% they look
   nearly alike, *because they are*: every game went in because it added the most
   at the time, so of course they contribute alike.
2. **A share of one shelf is not comparable to a share of another**, so any
   roll-up across a grid has to pick one shelf and name it, not pool five.

**What survives and is worth building on.** The findings that still work all
either name a game (`Gaps — what is missing`, `The same game twice`), draw
coverage as a shape rather than a number (the radar), or state a plain fact
(`What it contains`: plays alone, shortest, longest, weight range). `covers` and
`totalOf` in `engine/shelf.js` are the primitives a replacement would use, and
the measurement in the note left at the deletion site still holds: **measure on
the 77 axes, not the 12 spokes** — over spokes this collection's games spread
64× apart, over axes 2×, and the 64× was an artefact of twelve groups standing
in for seventy-seven.

**The question to answer:** what does a reader want to know about a shelf that
is not "which game would I add" and not "is anything here twice"? If the answer
is "what would I drop", the honest form is probably a named game with a reason
in words, not a gradient — the same shape `Gaps` already uses in the other
direction.
