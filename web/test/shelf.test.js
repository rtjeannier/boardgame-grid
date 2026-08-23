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

test('with no axes the collection is one cell that stops on its own', () => {
  // `buildCells(ix, { axes: [] })` is the collection: one cell, whole corpus.
  // Python says the same thing, which is what makes the grid a form of it.
  const { grid, depths } = buildGrid(ix, { axes: [] });
  assert.equal(grid.length, 1);
  assert.equal(grid[0].key, '');
  // Twelve, and not by anybody's choosing: the thirteenth game adds 0.27 where
  // the twelfth added 0.62. Python reads the same number off the same curve.
  assert.equal(grid[0].picks.length, 12);
  assert.equal(depths.cell.depth, 12);
  assert.equal(depths.cell.auto, true);
  assert.equal(grid[0].picks[0].name, 'Brass: Birmingham');
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
