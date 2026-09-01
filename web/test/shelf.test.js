/**
 * The whole loop a reader goes through, driven through the engine.
 *
 * Import a shelf, see what earned its place, ban something, pin something —
 * each of these is a setting the UI writes and the engine reads, so testing
 * them here covers the wiring without needing a browser.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildGrid, cellOverrideKey, coverageWeights, covers, indexContract, redundancies,
  spokeCoverage,
} from '../src/engine/index.js';
import { parseCollectionCsv } from '../src/ui/importCsv.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ix = indexContract(JSON.parse(readFileSync(
  join(HERE, '..', '..', 'tests', 'parity', 'seed-contract.json'), 'utf8')));

const shelved = (grid) => new Set(grid.flatMap((c) => c.picks.map((p) => p.id)));
const base = buildGrid(ix);

test('a CSV import lands games the engine recognises', () => {
  const top = [...Array(6)].map((_, i) => ix.ids[i]);
  const csv = 'objectname,objectid,own\n'
    + top.map((id, i) => `Game ${i},${id},1`).join('\n');
  const { matched } = parseCollectionCsv(csv, ix);
  assert.deepEqual(matched.sort((a, b) => a - b), [...top].sort((a, b) => a - b));
});

test('owned games are marked without being pinned', () => {
  const owned = [...shelved(base.grid)].slice(0, 4);
  const { grid } = buildGrid(ix, { owned });
  const marked = grid.flatMap((c) => c.picks).filter((p) => p.owned).map((p) => p.id);
  assert.deepEqual(marked.sort(), [...owned].sort());
  assert.deepEqual(
    [...shelved(grid)].sort(), [...shelved(base.grid)].sort(),
    'marking a game as owned must not change what gets picked',
  );
});

test('a keeper is shelved even when it would not have earned a slot', () => {
  const unshelved = [];
  for (let g = 0; g < ix.n && unshelved.length < 1; g++) {
    if (!shelved(base.grid).has(ix.ids[g]) && ix.playerFit.start[g + 1] > ix.playerFit.start[g]) {
      unshelved.push(ix.ids[g]);
    }
  }
  const { grid } = buildGrid(ix, { keepers: unshelved, owned: unshelved });
  assert.ok(shelved(grid).has(unshelved[0]), 'a pinned game must appear');
});

test('banning a game removes it and refills its slot', () => {
  const victim = [...shelved(base.grid)][10];
  const { grid } = buildGrid(ix, { banned: [victim] });
  assert.ok(!shelved(grid).has(victim));

  // Not "the same number of picks": banning changes what that shelf's own curve
  // looks like, so its depth may move by a place. What must hold is that no
  // hole was left — the shelf is still full to whatever depth it was given.
  const homeBefore = base.grid.find((c) => c.picks.some((p) => p.id === victim));
  const after = buildGrid(ix, { banned: [victim] });
  const homeAfter = after.grid.find((c) => c.key === homeBefore.key);
  assert.equal(homeAfter.picks.length, after.depths.capacity.get(homeBefore.key),
    'the slot was left empty');
});

test('a banned game is not offered as an alternate either', () => {
  const victim = [...shelved(base.grid)][10];
  const { grid } = buildGrid(ix, { banned: [victim] });
  const offered = new Set(grid.flatMap((c) => c.alternates.map((a) => a.id)));
  assert.ok(!offered.has(victim), 'a runner-up already turned down is not a suggestion');
});

test('banning beats keeping, so getting rid of something you own works', () => {
  const victim = [...shelved(base.grid)][3];
  const { grid } = buildGrid(ix, {
    owned: [victim], keepers: [victim], banned: [victim],
  });
  assert.ok(!shelved(grid).has(victim));
});

test('discounting a kind to zero thins it out', () => {
  const groupOf = new Map();
  for (const pick of base.grid.flatMap((c) => c.picks)) {
    const g = ix.rowOf.get(pick.id);
    let best = 0, at = 0;
    const totals = new Array(ix.groups.length).fill(0);
    for (let k = ix.embedding.start[g]; k < ix.embedding.start[g + 1]; k++) {
      totals[ix.groupOf[ix.embedding.idx[k]]] += ix.embedding.val[k];
    }
    totals.forEach((v, i) => { if (v > best) { best = v; at = i; } });
    groupOf.set(pick.id, at);
  }
  const counts = new Array(ix.groups.length).fill(0);
  for (const v of groupOf.values()) counts[v]++;
  const biggest = counts.indexOf(Math.max(...counts));

  const { grid } = buildGrid(ix, { genreWeights: { [biggest]: 0 } });
  const after = [...shelved(grid)].filter((id) => groupOf.get(id) === biggest).length;
  assert.ok(after < counts[biggest],
    `expected fewer than ${counts[biggest]} picks of the discounted kind, got ${after}`);
});

const inColumn = (grid, label) =>
  grid.filter((c) => c.column === label).reduce((n, c) => n + c.picks.length, 0);

test('capping a column shelves fewer games there', () => {
  // Against a flat depth, not against the default — the default reads depth off
  // each column's own curve and is already tighter here than this cap.
  const flat = buildGrid(ix, { capacity: 5 });
  const capacity = {};
  for (const cell of flat.cells) capacity[cell.key] = cell.key.startsWith('8+|') ? 2 : 5;
  const { grid } = buildGrid(ix, { capacity });
  assert.ok(inColumn(grid, '8+') < inColumn(flat.grid, '8+'),
    `${inColumn(grid, '8+')} should be fewer than ${inColumn(flat.grid, '8+')}`);
});

test('depth read from the curve is tighter at nine-plus than a flat five', () => {
  // The point of reading depth rather than setting it: nine-plus has 25 games
  // that reach it at all, so asking for five a shelf shelves whatever is left.
  // The curve says one — after the best there, the next is worth a quarter.
  const flat = buildGrid(ix, { capacity: 5 });
  assert.ok(inColumn(base.grid, '8+') < inColumn(flat.grid, '8+'),
    `auto ${inColumn(base.grid, '8+')} should be fewer than flat ${inColumn(flat.grid, '8+')}`);
  assert.equal(base.depths.columnDepth.get('8+').depth, 1);
  assert.equal(base.depths.columnDepth.get('8+').auto, true);
});

test('one game leaving moves a depth by a place, never across the shelf', () => {
  // The rule this replaces cut at the sharpest fall, which is an argmax: block
  // one game and the largest drop relocates, so a column swung from eleven to
  // five. A threshold on the level is monotone.
  const victim = [...shelved(base.grid)][2];
  const after = buildGrid(ix, { banned: [victim] });
  for (const [key, before] of base.depths.columnDepth) {
    const moved = Math.abs(after.depths.columnDepth.get(key).depth - before.depth);
    assert.ok(moved <= 2,
      `column ${key} moved ${before.depth} -> ${after.depths.columnDepth.get(key).depth}`);
  }
});

test('a depth a reader types beats both', () => {
  const { depths } = buildGrid(ix, { depthOverrides: { 'column:8+': 4 } });
  assert.equal(depths.columnDepth.get('8+').depth, 4);
  assert.equal(depths.columnDepth.get('8+').auto, false);
  assert.equal(depths.columnDepth.get('8+').read, 1);
});

test('the register is a guide: a column typed over it keeps its own number', () => {
  // Regression. `perShelfCap` used to *replace* the layer holding the column and
  // row overrides, so with the register set to five, typing nine on a column
  // changed nothing and never said why. Measured on the live corpus at the time:
  // global 5 gave 35 games across seven columns, and typing 12 on one of them
  // still gave 35.
  const flat = buildGrid(ix, { perShelfCap: 5 });
  const typed = buildGrid(ix, { perShelfCap: 5, depthOverrides: { 'column:3': 9 } });

  assert.equal(typed.depths.columnDepth.get('3').depth, 9, 'the typed column');
  assert.ok(inColumn(typed.grid, '3') > inColumn(flat.grid, '3'),
    `column 3: ${inColumn(flat.grid, '3')} -> ${inColumn(typed.grid, '3')}`);

  // ...and no other column moved, so the register still governs everything the
  // reader has not spoken about.
  for (const [key, before] of flat.depths.columnDepth) {
    if (key === '3') continue;
    assert.equal(typed.depths.columnDepth.get(key).depth, before.depth,
      `column ${key} should still be taking the register's five`);
  }
});

test('a depth typed on one axis does not become a depth on the other', () => {
  // Regression, and the shelf a fit would not touch. With one axis on, a cell
  // key is a bare string: the 3-players column and weight band 3 are both "3".
  // A 25 typed on the column therefore became band 3's depth the moment the
  // reader dropped players and added weight — and because "fit the shelves"
  // measures against the resolved depth, band 3 read 25, held 25, and the fit
  // agreed with it and never offered to trim.
  const key = cellOverrideKey(['players'], '3');
  assert.equal(key, 'cell:players:3');

  const typed = buildGrid(ix, { axes: ['players'], depthOverrides: { [key]: 25 } });
  assert.equal(typed.depths.cellDepth.get('3').depth, 25, 'the column it was typed on');

  const other = buildGrid(ix, { axes: ['weight'], depthOverrides: { [key]: 25 } });
  assert.equal(other.depths.cellDepth.get('3').set, false,
    'a number typed on the player column reached weight band 3');
  assert.ok(other.depths.cellDepth.get('3').depth < 25,
    `weight band 3 took ${other.depths.cellDepth.get('3').depth} from the other axis`);

  // Two axes keep the unprefixed form, because that is the key `pipeline/depth.py`
  // resolves and `tests/parity` asserts across both engines.
  assert.equal(cellOverrideKey(['players', 'weight'], '3|2'), 'cell:3|2');
  const both = buildGrid(ix, { depthOverrides: { 'cell:3|2': 7 } });
  assert.equal(both.depths.cellDepth.get('3|2').depth, 7);
});

test('a header reports the depth it is using, not one it is not', () => {
  // The field used to show the column's own reading while the column held the
  // register's number — nine on screen, five on the shelf. `read` keeps the
  // curve's answer for "back to what the shelf reads" to restore.
  const { depths } = buildGrid(ix, { perShelfCap: 5 });
  const nine = depths.columnDepth.get('8+');
  assert.equal(nine.depth, 5, 'what the column is doing');
  assert.equal(nine.read, 1, 'what its curve says');
});

test('no layer is a ceiling: a cell can always take one more', () => {
  // "The per cell value should just be a guide not a restriction. Nothing should
  // ever block a cell from adding or losing a value." Asserted at every layer,
  // and at both of them at once.
  const layers = {
    'nothing set': {},
    'the register set': { perShelfCap: 4 },
    'a column typed': { depthOverrides: { 'column:3': 4 } },
    'both': { perShelfCap: 4, depthOverrides: { 'column:3': 6 } },
  };
  for (const [what, options] of Object.entries(layers)) {
    const before = buildGrid(ix, options);
    const cell = before.grid.find((c) => c.key.startsWith('3|') && c.alternates.length);
    assert.ok(cell, `${what}: no cell in column 3 with anything left to take`);

    const held = cell.picks.length;
    const after = buildGrid(ix, {
      ...options,
      depthOverrides: { ...options.depthOverrides, [`cell:${cell.key}`]: held + 1 },
    });
    assert.equal(after.grid.find((c) => c.key === cell.key).picks.length, held + 1,
      `${what}: cell ${cell.key} should have gone ${held} -> ${held + 1}`);
  }
});

test('with no axes the collection is one cell that stops on its own', () => {
  // `buildCells(ix, { axes: [] })` is the collection: one cell, whole corpus.
  // Python says the same thing, which is what makes the grid a form of it.
  const { grid, depths } = buildGrid(ix, { axes: [] });
  assert.equal(grid.length, 1);
  assert.equal(grid[0].key, '');
  // A dozen or so, and not by anybody's choosing — the curve falls off and the
  // reading stops there. The exact number and the names in it belong to whatever
  // corpus is shipped, so the test asserts the shape of the answer, not the
  // answer: small, non-empty, and read rather than set.
  assert.ok(grid[0].picks.length >= 5 && grid[0].picks.length <= 30,
    `a collection of ${grid[0].picks.length} is not a collection`);
  assert.equal(depths.cell.depth, grid[0].picks.length);
  assert.equal(depths.cell.auto, true);
});

test('a budget is a second ceiling, and the smaller one wins', () => {
  const size = (b) => b.grid.reduce((n, c) => n + c.picks.length, 0);
  const full = size(base);
  for (const n of [1, 12, 60, full]) {
    assert.equal(size(buildGrid(ix, { budget: n })), n,
      `a budget of ${n} with everything costing one game should give ${n} games`);
  }
  // Above what the shelves can hold, depth is the binding ceiling and the
  // budget does nothing — which is the point of both applying.
  assert.equal(size(buildGrid(ix, { budget: full * 2 })), full);
});

test('a budget spends on the best value first', () => {
  // Games bought under a budget are the ones the unbudgeted collection ranks
  // highest, not an arbitrary set: same rule, stopped earlier. The budget is a
  // ceiling, so it may buy fewer than it allows when the curve stops first.
  const budgeted = buildGrid(ix, { axes: [], budget: 10 }).grid[0].picks.map((p) => p.name);
  const open = buildGrid(ix, { axes: [] }).grid[0].picks.map((p) => p.name);
  assert.ok(budgeted.length > 0 && budgeted.length <= 10,
    `a budget of ten bought ${budgeted.length}`);
  for (const name of budgeted) {
    assert.ok(open.includes(name), `${name} is not in the open collection`);
  }
});

test('what a game brings is named from the axes, not from the spokes', () => {
  // Regression, and it was mislabelling the one recommendation the rail makes.
  // Measuring coverage *in* spoke space rather than projecting the axis
  // measurement into it names a different top family on 7 of 30 shelves — and
  // the spoke answer is the wrong one: Roll for the Galaxy is a dice game.
  const weights = coverageWeights(ix);
  const top = (row) => {
    const cover = spokeCoverage(ix, weights, [row]);
    return ix.groups
      .map((g, i) => ({ name: g.name.split(' · ')[0], v: cover[i] }))
      .sort((a, b) => b.v - a.v)[0].name;
  };
  const named = (name) => ix.names.findIndex((n) => n.startsWith(name));
  for (const [game, family] of [['Roll for the Galaxy', 'Dice']]) {
    const row = named(game);
    if (row < 0) continue;      // the seed corpus does not carry every game
    assert.equal(top(row), family, `${game} should read as ${family}`);
  }

  // And the projection is the radar's, so one question has one answer: a set's
  // coverage cannot depend on which module asked for it.
  const rows = [...Array(8)].map((_, i) => i);
  const once = spokeCoverage(ix, weights, rows);
  assert.equal(once.length, ix.groups.length);
  assert.ok(once.every((v) => v >= 0 && v <= 1), 'a spoke read outside 0..1');
});

test('a duplicate is the same game twice, not two games that resemble each other', () => {
  const rows = (names) => names.map((n) => ix.names.indexOf(n)).filter((r) => r >= 0);
  const names = (out) => out.map((r) => r.name);

  // Identity, so it is a lookup against what BGG publishes rather than a
  // threshold on likeness. A threshold cannot do this job in either direction:
  // 7 Wonders and its second edition score 0.79 on similarity, under any floor
  // that also excludes Navegador and Orléans — which the measure this replaces
  // reported as 96% duplicated while the selector put them at 0.00.
  for (const [a, b, who] of [
    ['7 Wonders', '7 Wonders (Second Edition)', null],
    ['Gloomhaven: Jaws of the Lion', 'Gloomhaven', 'Gloomhaven: Jaws of the Lion'],
    ['Brass: Lancashire', 'Brass: Birmingham', 'Brass: Lancashire'],
    ['Wyrmspan', 'Wingspan', 'Wyrmspan'],
  ]) {
    const pair = rows([a, b]);
    if (pair.length < 2) continue;
    const found = redundancies(ix, pair);
    assert.equal(found.length, 1, `${a} / ${b}: a reissue went unreported`);
    if (who) {
      assert.equal(found[0].name, who,
        `${a} / ${b}: named the better known half`);
    }
  }

  // And nothing else is one, however alike two games look.
  for (const [a, b] of [['Navegador', 'Orléans'], ['Root', 'Blood Rage'],
                        ['Azul', 'Gloomhaven'], ['Hitster', 'Captain Sonar']]) {
    const pair = rows([a, b]);
    if (pair.length < 2) continue;
    assert.deepEqual(names(redundancies(ix, pair)), [], `${a} / ${b} is not a reissue`);
  }
  assert.deepEqual(redundancies(ix, rows(['Azul'])), []);
});

test('every pinned game holds a place, even when they displace each other', () => {
  const idOf = (name) => ix.ids[ix.names.indexOf(name)];
  const owned = ['Gloomhaven', 'Gloomhaven: Jaws of the Lion', 'Wingspan', 'Wyrmspan']
    .map(idOf);
  const { grid } = buildGrid(ix, { axes: [], owned, keepers: owned });
  const held = new Set(grid.flatMap((c) => c.picks.map((p) => p.id)));
  for (const id of owned) {
    assert.ok(held.has(id), `${ix.names[ix.rowOf.get(id)]} was pinned and is not shelved`);
  }
});

test('blocking a game never changes how deep a shelf goes', () => {
  // A promise, not a side effect: the reading is set by the axis alone, so a
  // block changes *which* games fill the shelves and never *how many*. Before
  // this, blocking one game moved two columns by a place and everything below
  // them reflowed for a reason nobody could see.
  const victim = [...shelved(base.grid)][2];
  const after = buildGrid(ix, { banned: [victim] });
  for (const [key, before] of base.depths.columnDepth) {
    assert.equal(after.depths.columnDepth.get(key).depth, before.depth,
      `column ${key} moved when a game was blocked`);
  }
  for (const [key, before] of base.depths.rowDepth) {
    assert.equal(after.depths.rowDepth.get(key).depth, before.depth,
      `row ${key} moved when a game was blocked`);
  }
});

test('dropping a band re-homes its games, and the fit is not order-dependent', () => {
  // Reported: "if I get rid of the row that has Gloomhaven I might expect it to
  // reappear on a different row — instead the cell is not changing even when I
  // refit." Re-homing worked; the *fit* deleted it. A re-homed game was appended
  // to the end of its new shelf's list and the trim cut from the end, so the
  // games that had just moved were always the first to go, whatever they were
  // worth. Order-independence is the exact shape of that bug: a trim by position
  // gives a different answer when the same games arrive in a different order,
  // and a trim by score cannot.
  const P = (b) => new Map(b.grid.flatMap((c) => c.picks.map((p) => [p.id, c.key])));
  const axes = ['players', 'weight'];
  const one = buildGrid(ix, { axes: ['players'] });
  const grid = buildGrid(ix, { axes, held: [...P(one).keys()], heldAt: P(one) });
  const settled = buildGrid(ix, { axes, held: grid.filled.ids, heldAt: grid.filled.at });
  const before = P(settled);

  // Drop the last band: it merges into its neighbour, so that shelf holds more
  // than it reads and the fit has to give something up.
  const last = settled.rows.length - 1;
  const shape = { axes, rowCount: last,
                  rowEdges: settled.rows.slice(0, -1).map((r) => r.hi).slice(0, -1) };
  const homeless = [...before].filter(([, key]) => key.endsWith(`|${last}`)).map(([id]) => id);
  assert.ok(homeless.length, 'nothing was in the band being dropped');

  const after = buildGrid(ix, { ...shape, held: [...before.keys()], heldAt: before });
  const dealt = P(after);
  assert.equal(dealt.size, before.size, 'dropping a band lost games outright');
  for (const id of homeless) {
    assert.ok(dealt.has(id), `${ix.names[ix.rowOf.get(id)]} vanished when its band went`);
    assert.notEqual(dealt.get(id), before.get(id), 'a re-homed game kept a shelf that is gone');
  }

  // The fit trims, and what it keeps does not depend on what order it was told.
  const fitFrom = (order) => buildGrid(ix, {
    ...shape, held: order, heldAt: new Map(order.map((id) => [id, before.get(id)])),
  }).filled;
  const forwards = fitFrom([...before.keys()]);
  const backwards = fitFrom([...before.keys()].reverse());
  assert.ok(forwards.ids.length < before.size, 'the fit trimmed nothing at all');
  assert.deepEqual(new Set(forwards.ids), new Set(backwards.ids),
    'the fit keeps different games depending on the order it was handed them');

  // And it settles rather than drifting on every press.
  const again = buildGrid(ix, { ...shape, held: forwards.ids, heldAt: forwards.at });
  assert.equal(P(again).size, forwards.ids.length, 'the grid did not settle after a fit');
});

test('a rebuild is a pure function of the settings', () => {
  const sign = (b) => b.grid.map((c) => `${c.key}:${c.picks.map((p) => p.id)}`).sort().join('|');
  const [a, b] = [...shelved(base.grid)].slice(0, 2);
  assert.equal(sign(buildGrid(ix, { banned: [a, b] })), sign(buildGrid(ix, { banned: [b, a] })),
    'the order things were banned in changed the answer');
  assert.equal(sign(buildGrid(ix, { banned: [] })), sign(base),
    'unbanning did not restore the collection exactly');
});

test('the expensive getters cannot be reached by spreading the result', () => {
  // `{ ...built }` invokes every enumerable getter, and two of them are whole
  // extra builds. A standfirst spread `built` to add one field, so `get filled`
  // ran on every render: 699 of the 734 scoring passes behind a single click
  // came from there, and blocking a game cost 586ms instead of 133ms. Making
  // them non-enumerable is a property of the object rather than a rule someone
  // has to remember.
  const built = buildGrid(ix, { axes: ['players', 'weight'] });
  const keys = Object.keys(built);
  for (const hidden of ['data', 'filled']) {
    assert.ok(!keys.includes(hidden), `${hidden} is enumerable, so a spread runs it`);
    assert.ok(hidden in built, `${hidden} should still be reachable directly`);
  }

  // The real assertion: spreading it does no work at all.
  const before = Date.now();
  const copy = { ...built, extra: 1 };
  assert.ok(Date.now() - before < 50, 'spreading the result ran a build');
  assert.equal(copy.data, undefined);
  assert.equal(copy.filled, undefined);

  // ...and asking for them directly still works.
  assert.ok(Array.isArray(built.filled.ids), 'filled stopped working');
  assert.ok(built.data, 'data stopped working at two axes');
});

test('the collection is not capped at how deep its curve was read', () => {
  // `COLLECTION_PROBE` is how far the curve is read, and it used to clamp the
  // answer too: `Math.min(COLLECTION_PROBE, set)`. Asking the unsplit
  // collection for more than 120 games gave 120, while the control that asked
  // went on saying the number you typed.
  for (const ask of [119, 120, 121, 150]) {
    const held = buildGrid(ix, { axes: [], depthOverrides: { collection: ask } })
      .grid[0].picks.length;
    assert.equal(held, ask, `asked for ${ask}, got ${held}`);
  }
});

test('a low returns bar deepens the shelves without stalling the rebuild', () => {
  // Reported as a crash: setting the bar to 5% froze the tab. `repair` rescored
  // a cell inside the loop over that cell's own picks, and again for every cell
  // it compared against, so a shelf of twenty rescored itself twenty times over
  // — 15,161 scoring passes against 452 at the default, and 72 seconds for one
  // rebuild. Nothing changes between those calls, so they are cached per pass.
  const at = (leftover) => {
    const started = Date.now();
    const built = buildGrid(ix, { axes: ['players', 'weight'], autoDepthLeftover: leftover });
    return { ms: Date.now() - started,
             games: built.grid.reduce((n, c) => n + c.picks.length, 0) };
  };
  const normal = at(0.45);
  const deep = at(0.05);

  // The bar is what it is for: a lower one takes more games.
  assert.ok(deep.games > normal.games,
    `5% should take more than 45%, got ${deep.games} against ${normal.games}`);
  // And it stays within reach of the default rather than running away with it.
  // Measured on the seed corpus this is a handful of times slower, not eighty.
  assert.ok(deep.ms < normal.ms * 30 + 2000,
    `5% took ${deep.ms}ms against ${normal.ms}ms at the default`);
});

test('the shipped contract rebuilds fast enough to be a control surface', () => {
  // The *shipped* contract, not the seed fixture the rest of this file uses.
  // Named for it and measuring the other one, this guarded nothing: the seed is
  // a fifth the size and rebuilds in a fifth the time.
  //
  // Every click rebuilds — a split, a depth, a pin, a block — so this is the
  // only thing between a bigger corpus and an app that stutters. Measured at
  // ~490ms on an idle machine; the budget is set to catch a regression of that,
  // not to assert an aspiration. Do not raise it to make a change fit.
  const shipped = indexContract(JSON.parse(readFileSync(
    join(HERE, '..', 'public', 'grid.contract.json'), 'utf8')));
  const budget = 900;
  buildGrid(shipped, { axes: ['players', 'weight'] });
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    buildGrid(shipped, { axes: ['players', 'weight'] });
    best = Math.min(best, performance.now() - t);
  }
  assert.ok(best < budget, `a two-split rebuild took ${best.toFixed(0)}ms, budget ${budget}ms`);
});
