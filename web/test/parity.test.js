/**
 * The JS engine must pick what Python picks.
 *
 * Selection runs in the browser so a reader can change something and see the
 * grid move, but the model stays offline in Python — so the allocator exists
 * twice. Two implementations of one formula drift, and this repo already
 * carried that risk once: `web/src/coverage.js` mirrored
 * `coverage.axis_coverage` with nothing but a comment holding them together.
 *
 * Fixtures come from `python -m tests.parity.generate`, on the seed dataset so
 * a fresh clone can reproduce them. Regenerate only when a change is *meant*
 * to move picks, and say which of the four numbers moved.
 *
 *     node --test web/test/
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildGrid } from '../src/engine/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'tests', 'parity');

const contract = JSON.parse(readFileSync(join(FIXTURES, 'seed-contract.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(FIXTURES, 'golden.json'), 'utf8'));
const nameOf = new Map(contract.games.map((g) => [g.id, g.name]));

for (const { name, options, picks } of golden) {
  test(`parity: ${name}`, () => {
    const { grid } = buildGrid(contract, options);
    const mine = Object.fromEntries(grid.map((c) => [c.key, c.picks.map((p) => p.id)]));

    assert.deepEqual(
      Object.keys(mine).sort(), Object.keys(picks).sort(),
      'the two engines disagree about which cells exist at all',
    );

    for (const key of Object.keys(picks).sort()) {
      const show = (ids) => ids.map((i) => nameOf.get(i) ?? i).join(', ');
      assert.deepEqual(
        mine[key], picks[key],
        `cell ${key}\n    python: ${show(picks[key])}\n    js:     ${show(mine[key])}`,
      );
    }
  });
}

test('parity: total picks match across every case', () => {
  for (const { name, options, picks } of golden) {
    const { grid } = buildGrid(contract, options);
    const expected = Object.values(picks).reduce((n, p) => n + p.length, 0);
    const got = grid.reduce((n, c) => n + c.picks.length, 0);
    assert.equal(got, expected, `${name}: ${got} picks against Python's ${expected}`);
  }
});
