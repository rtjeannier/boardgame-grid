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

import { buildGrid, indexContract } from '../src/engine/index.js';
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

  const homeBefore = base.grid.find((c) => c.picks.some((p) => p.id === victim));
  const homeAfter = grid.find((c) => c.key === homeBefore.key);
  assert.equal(homeAfter.picks.length, homeBefore.picks.length, 'the slot was refilled');
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

test('a smooth curve falls back to the set depth and says so', () => {
  // Four players slopes rather than falls, so any cut would be arbitrary: the
  // reading is declined and the number a reader set applies instead.
  const four = base.depths.columnDepth.get('4');
  assert.equal(four.auto, false);
  assert.equal(four.depth, 5);
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
