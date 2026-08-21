/**
 * The reader's settings survive a round trip through a URL.
 *
 * Sharing a configured grid is the whole point of encoding them, and a lossy
 * encode fails quietly: the link works, the grid loads, and it is subtly not
 * the grid that was shared.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULTS, decode, encode, packIds, toggleIn, unpackIds,
} from '../src/settings.js';

test('a default grid encodes to nothing at all', () => {
  assert.equal(encode({ ...DEFAULTS }), '');
});

test('ids survive delta packing', () => {
  const ids = [224517, 266192, 174430, 13, 224517];
  const back = unpackIds(packIds(ids));
  assert.deepEqual(back, [...new Set(ids)].sort((a, b) => a - b));
});

test('packing is shorter than spelling ids out', () => {
  const ids = Array.from({ length: 100 }, (_, i) => 100000 + i * 137);
  assert.ok(packIds(ids).length < ids.join(',').length * 0.7);
});

test('every setting round-trips', () => {
  const settings = {
    ...DEFAULTS,
    rowCount: 3,
    picksPerCell: 7,
    gainFloor: 0.15,
    picksPerColumn: { '8+': 2 },
    genreWeights: { 3: 0, 7: 1.5 },
    columns: [{ label: '1-2', lo: 1, hi: 2 }, { label: '3+', lo: 3, hi: null }],
    owned: [224517, 266192],
    keepers: [224517],
    banned: [174430],
  };
  assert.deepEqual(decode(encode(settings)), settings);
});

test('an open-ended column survives, since null is not JSON-safe in an array', () => {
  const settings = {
    ...DEFAULTS,
    columns: [{ label: 'all', lo: 1, hi: null }],
  };
  assert.equal(decode(encode(settings)).columns[0].hi, null);
});

test('a corrupt hash falls back to defaults rather than throwing', () => {
  assert.deepEqual(decode('not%20json'), { ...DEFAULTS });
  assert.deepEqual(decode(''), { ...DEFAULTS });
});

test('banning something drops it from keepers, and keeping un-bans', () => {
  const base = { ...DEFAULTS, keepers: [7], banned: [] };
  const banned = { ...base, ...toggleIn(base, 'banned', 7) };
  assert.deepEqual(banned.banned, [7]);
  assert.deepEqual(banned.keepers, [], 'a game cannot be both wanted and refused');

  const kept = { ...banned, ...toggleIn(banned, 'keepers', 7) };
  assert.deepEqual(kept.keepers, [7]);
  assert.deepEqual(kept.banned, []);
});

test('toggling twice returns to where it started', () => {
  const once = { ...DEFAULTS, ...toggleIn(DEFAULTS, 'owned', 42) };
  const twice = { ...once, ...toggleIn(once, 'owned', 42) };
  assert.deepEqual(twice.owned, []);
});
