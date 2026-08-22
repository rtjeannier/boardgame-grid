/**
 * Reading a BoardGameGeek collection export.
 *
 * The interesting part is not matching — ids make that trivial — but what is
 * said about the rows that do *not* match. A working import leaves plenty
 * unmatched, because expansions are excluded from the corpus by construction,
 * so a bare count reads as a failure when nothing failed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCollectionCsv, parseCsv } from '../src/ui/importCsv.js';

const ix = { rowOf: new Map([[224517, 0], [266192, 1], [174430, 2]]) };

test('quoted fields, doubled quotes and embedded newlines', () => {
  const rows = parseCsv('a,b\n"say ""hi""","two\nlines"\n');
  assert.deepEqual(rows, [['a', 'b'], ['say "hi"', 'two\nlines']]);
});

test('games are matched by id, never by name', () => {
  const csv = 'objectname,objectid,own\n'
    + '"Totally The Wrong Name",224517,1\n';
  const { matched } = parseCollectionCsv(csv, ix);
  assert.deepEqual(matched, [224517], 'the id is authoritative');
});

test('unmatched rows are classified, not just counted', () => {
  const csv = 'objectname,objectid,own,itemtype\n'
    + 'Brass,224517,1,standalone\n'
    + 'Wingspan Oceania,300580,1,expansion\n'
    + 'Obscure Thing,999999,1,standalone\n';
  const report = parseCollectionCsv(csv, ix);
  assert.deepEqual(report.matched, [224517]);
  assert.equal(report.expansions, 1, 'expansions are expected, not a failure');
  assert.deepEqual(report.unmatched.map((u) => u.id), [999999]);
});

test('wishlisted and previously-owned rows are not imported as owned', () => {
  const csv = 'objectname,objectid,own\nBrass,224517,1\nWanted,266192,0\n';
  assert.deepEqual(parseCollectionCsv(csv, ix).matched, [224517]);
});

test('an export with no own column treats every row as held', () => {
  const csv = 'objectname,objectid\nBrass,224517\nWingspan,266192\n';
  assert.deepEqual(parseCollectionCsv(csv, ix).matched, [224517, 266192]);
});

test('duplicate rows collapse', () => {
  const csv = 'objectname,objectid,own\nBrass,224517,1\nBrass again,224517,1\n';
  assert.deepEqual(parseCollectionCsv(csv, ix).matched, [224517]);
});

test('junk does not throw', () => {
  for (const junk of ['', 'not,a,collection\n', 'objectid\nabc\n']) {
    const r = parseCollectionCsv(junk, ix);
    assert.deepEqual(r.matched, []);
  }
});
