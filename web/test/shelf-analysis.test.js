/**
 * The collection as a whole, rather than cell by cell.
 *
 * Cell membership is deliberately absent: a shelf is not played at one player
 * count, so a game contributes its full quality-scaled loading here where the
 * grid would scale it by fit.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyseShelf, buildGrid, coverageOf, indexContract } from '../src/engine/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ix = indexContract(JSON.parse(readFileSync(
  join(HERE, '..', '..', 'tests', 'parity', 'seed-contract.json'), 'utf8')));
const built = buildGrid(ix);
const rowsFor = (n) => new Set([...Array(n)].map((_, i) => i * 13).filter((r) => r < ix.n));

test('a set covers a spoke unless every game misses it', () => {
  assert.deepEqual(coverageOf([], 3), [0, 0, 0]);
  assert.deepEqual(coverageOf([[1, 0, 0]], 3), [1, 0, 0]);
  // Two half-covering games leave a quarter uncovered, not nothing.
  assert.deepEqual(coverageOf([[0.5, 0, 0], [0.5, 0, 0]], 3), [0.75, 0, 0]);
});

test('coverage never exceeds one spoke per spoke', () => {
  const a = analyseShelf(ix, built.weights, rowsFor(30));
  assert.equal(a.coverage.length, ix.groups.length);
  assert.ok(a.coverage.every((v) => v >= 0 && v <= 1));
  assert.ok(a.total <= a.spokes);
});

test('a bigger shelf covers at least as much', () => {
  const small = analyseShelf(ix, built.weights, rowsFor(5));
  const large = analyseShelf(ix, built.weights, rowsFor(40));
  assert.ok(large.total >= small.total, `${large.total} should be >= ${small.total}`);
});

test('unique contribution is what would vanish without the game', () => {
  const rows = rowsFor(12);
  const a = analyseShelf(ix, built.weights, rows);
  assert.equal(a.unique.length, rows.size);
  assert.ok(a.unique.every((g) => g.unique >= -1e-9), 'removing a game cannot add coverage');
  // Sorted least-unique first: that is the order somebody deciding what to sell
  // wants to read.
  const values = a.unique.map((g) => g.unique);
  assert.deepEqual(values, [...values].sort((x, y) => x - y));
});

test('a lone game contributes everything it covers', () => {
  const only = [...rowsFor(1)][0];
  const a = analyseShelf(ix, built.weights, new Set([only]));
  assert.ok(Math.abs(a.unique[0].unique - a.total) < 1e-6);
});

test('gaps are the thin spokes, emptiest first, with fills that are not owned', () => {
  const rows = rowsFor(8);
  const a = analyseShelf(ix, built.weights, rows);
  const ownedIds = new Set([...rows].map((r) => ix.ids[r]));
  for (const gap of a.gaps) {
    assert.ok(gap.coverage < 0.5);
    for (const s of gap.suggestions) {
      assert.ok(!ownedIds.has(s.id), 'suggesting a game you already own is no suggestion');
    }
  }
  assert.deepEqual(a.gaps.map((g) => g.coverage),
                   [...a.gaps.map((g) => g.coverage)].sort((x, y) => x - y));
});

test('banned games are never suggested as fills', () => {
  const rows = rowsFor(8);
  const open = analyseShelf(ix, built.weights, rows);
  const first = open.gaps[0]?.suggestions[0];
  if (!first) return;
  const banned = new Set([ix.rowOf.get(first.id)]);
  const closed = analyseShelf(ix, built.weights, rows, { bannedRows: banned });
  const offered = new Set(closed.gaps.flatMap((g) => g.suggestions.map((s) => s.id)));
  assert.ok(!offered.has(first.id));
});

test('an empty shelf covers nothing and is all gap', () => {
  const a = analyseShelf(ix, built.weights, new Set());
  assert.equal(a.total, 0);
  assert.equal(a.unique.length, 0);
  assert.equal(a.gaps.length, ix.groups.length);
});
