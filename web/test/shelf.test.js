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
  buildGrid, coverageWeights, indexContract, redundancies,
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
  // Ten games under a budget are the ten the unbudgeted collection ranks
  // highest, not an arbitrary ten: same rule, stopped earlier.
  const ten = buildGrid(ix, { axes: [], budget: 10 }).grid[0].picks.map((p) => p.name);
  const open = buildGrid(ix, { axes: [] }).grid[0].picks.map((p) => p.name);
  assert.equal(ten.length, 10);
  for (const name of ten) assert.ok(open.includes(name), `${name} is not in the open collection`);
});

test('redundancy names the more contained half, and stays quiet otherwise', () => {
  const weights = coverageWeights(ix, null);
  const rows = (names) => names.map((n) => ix.names.indexOf(n)).filter((r) => r >= 0);

  // Two unrelated games duplicate nothing, which is the answer that made the
  // measure this replaces read backwards: it listed four regardless.
  assert.deepEqual(redundancies(ix, weights, rows(['Azul', 'Gloomhaven'])), []);
  assert.deepEqual(redundancies(ix, weights, rows(['Azul'])), []);

  const pair = rows(['Gloomhaven', 'Gloomhaven: Jaws of the Lion']);
  const found = redundancies(ix, weights, pair, { floor: 0.9 });
  assert.equal(found.length, 1, 'a real duplicate went unreported');
  // Jaws of the Lion is 95% covered by Gloomhaven and Gloomhaven only 83%
  // covered by it, so Jaws of the Lion is the redundant one.
  assert.equal(found[0].name, 'Gloomhaven: Jaws of the Lion');
  assert.equal(found[0].filledBy.name, 'Gloomhaven');
  assert.ok(found[0].share > 0.9);
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
