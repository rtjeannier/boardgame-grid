/**
 * Why a game was cut, and why it is computed rather than guessed.
 *
 * The copy this replaced said "something else won every cell they reach, often
 * a second edition". Both halves were speculation: nothing checked which cells,
 * and nothing checked for a second edition. The contract carries the relations
 * to answer it properly, so these assert that it does — and that the vaguest
 * answer is only reached when the specific ones do not apply.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  analyseShelf, buildGrid, cutSentence, explainCut, indexContract, similarityBetween,
} from '../src/engine/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ix = indexContract(JSON.parse(readFileSync(
  join(HERE, '..', '..', 'tests', 'parity', 'seed-contract.json'), 'utf8')));

const rowFor = (name) => ix.names.indexOf(name);

function context(owned = []) {
  const built = buildGrid(ix, { owned });
  const shelvedIds = new Set(built.grid.flatMap((c) => c.picks.map((p) => p.id)));
  return {
    built,
    shelved: new Set([...shelvedIds].map((id) => ix.rowOf.get(id))),
    shelvedIds,
    picksByCell: new Map(built.grid.map((c) => [c.key, c.picks.map((p) => ix.rowOf.get(p.id))])),
  };
}

test('similarity vectors are unit-norm, to within what the contract carries', () => {
  // Exactly one in the model; slightly under it here. The contract rounds to
  // four places and drops entries below 1e-4, so the shipped vector is a hair
  // shorter than the one the model computed — worst case 1.8e-4 across the seed
  // corpus. Asserting 1e-6 would be asserting precision that was deliberately
  // not shipped.
  let worst = 0;
  for (let g = 0; g < ix.n; g++) {
    worst = Math.max(worst, Math.abs(similarityBetween(ix, g, g) - 1));
  }
  assert.ok(worst < 1e-3, `worst deviation ${worst.toExponential(2)}`);
  assert.ok(worst > 0, 'precondition: the vectors really are quantised');
});

test('two unrelated games score far below a game against itself', () => {
  const a = rowFor('Gloomhaven'), b = rowFor('Codenames');
  if (a < 0 || b < 0) return;
  assert.ok(similarityBetween(ix, a, b) < 0.5 * similarityBetween(ix, a, a));
});

test('a superseded game says which game supersedes it', () => {
  // Jaws of the Lion carries no tag Gloomhaven lacks, in the same family.
  const thin = rowFor('Gloomhaven: Jaws of the Lion');
  const rich = rowFor('Gloomhaven');
  assert.ok(thin >= 0 && rich >= 0, 'both are in the seed corpus');
  assert.ok(ix.thin.get(thin)?.has(rich), 'the contract carries the relation');

  const { built, picksByCell } = context();
  const reason = explainCut(ix, thin, new Set([rich]), built.cells, picksByCell);
  assert.equal(reason.kind, 'superseded');
  assert.deepEqual(reason.by, ['Gloomhaven']);
  assert.match(cutSentence(reason), /Gloomhaven carries everything/);
});

test('the specific relations are preferred over the vague one', () => {
  const thin = rowFor('Gloomhaven: Jaws of the Lion');
  const { built, picksByCell, shelved } = context();
  // With nothing related shelved it must fall through to a cell-level answer.
  const vague = explainCut(ix, thin, new Set(), built.cells, picksByCell);
  assert.ok(['outranked', 'crowded', 'unplaceable'].includes(vague.kind));
  // With the fuller record shelved it must not.
  const specific = explainCut(ix, thin, shelved.add(rowFor('Gloomhaven')),
                              built.cells, picksByCell);
  assert.equal(specific.kind, 'superseded');
});

test('a game reaching no cell says so rather than blaming a rival', () => {
  const { built, picksByCell } = context();
  let stranded = -1;
  for (let g = 0; g < ix.n; g++) {
    if (!built.cells.some((c) => c.games.includes(g))) { stranded = g; break; }
  }
  if (stranded < 0) return;                   // every game placeable in this corpus
  const reason = explainCut(ix, stranded, new Set(), built.cells, picksByCell);
  assert.equal(reason.kind, 'unplaceable');
});

test('every cut game gets a sentence, whatever the reason', () => {
  const owned = [...Array(40)].map((_, i) => ix.ids[i * 7]);
  const { built, shelved, shelvedIds, picksByCell } = context(owned);
  const cut = owned.filter((id) => !shelvedIds.has(id));
  assert.ok(cut.length > 0, 'precondition: some owned games are cut');
  for (const id of cut) {
    const sentence = cutSentence(explainCut(ix, ix.rowOf.get(id), shelved,
                                            built.cells, picksByCell));
    assert.ok(sentence.length > 10 && !sentence.includes('undefined'), sentence);
  }
});
