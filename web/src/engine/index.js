/**
 * The selection engine: everything the grid needs, from the contract alone.
 *
 * The model is upstream and offline; this is the part that re-runs whenever a
 * reader changes something. It knows nothing about how genres were discovered —
 * only what the contract says they are.
 */

export { indexContract } from './contract.js';
export { ratingSpans, coverageWeights } from './quality.js';
export { buildWeightRows, buildCells } from './membership.js';
export { CoverageScorer } from './scorer.js';
export { allocate } from './allocate.js';
export { toGridData } from './present.js';

import { indexContract } from './contract.js';
import { ratingSpans, coverageWeights } from './quality.js';
import { buildWeightRows, buildCells } from './membership.js';
import { CoverageScorer } from './scorer.js';
import { allocate } from './allocate.js';
import { toGridData } from './present.js';

export const DEFAULT_COLUMNS = [
  { label: '1', lo: 1, hi: 1 }, { label: '2', lo: 2, hi: 2 },
  { label: '3', lo: 3, hi: 3 }, { label: '4', lo: 4, hi: 4 },
  { label: '5', lo: 5, hi: 5 }, { label: '6-8', lo: 6, hi: 8 },
  { label: '8+', lo: 9, hi: null },
];
export const DEFAULT_ROW_NAMES =
  ['Gateway', 'Light', 'Medium', 'Medium-Heavy', 'Heavy', 'Brain-burner'];

/**
 * Build a grid from the contract and the reader's settings.
 *
 * `include` filters the corpus, and when it is given the genre rating spans are
 * recomputed rather than taken from the contract — filter to 2015-and-newer and
 * the best wargame left may be mediocre, so nothing would score 1.0 on that
 * axis and it could never fill. That is the failure genre-relative quality
 * exists to prevent, and it comes straight back through a filter control.
 */
export function buildGrid(contract, {
  columns = DEFAULT_COLUMNS, rowCount = 5, rowNames = DEFAULT_ROW_NAMES,
  capacity = 5, alternatesLimit = 6,
  owned = [], keepers = [], banned = [],
  genreWeights = null, include = null, gainFloor = null, policy = null,
} = {}) {
  const base = contract.games ? indexContract(contract) : contract;
  // Policy travels with the model, so overriding it is a *test* affordance and
  // a sweep affordance — never something the interface exposes.
  const ix = policy ? { ...base, policy: { ...base.policy, ...policy } } : base;

  const weights = coverageWeights(ix, include ? ratingSpans(ix, include) : null);
  const rows = buildWeightRows(
    include ? [...ix.weight].filter((_, g) => include[g]) : ix.weight,
    rowCount, rowNames);
  const cells = buildCells(ix, { columns, rows, include });
  const scorer = new CoverageScorer(ix, weights, cells, { genreWeights });

  const rowsOf = (ids) => ids.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
  const seeded = new Map();
  for (const game of rowsOf(keepers)) {
    let best = null, degree = -1;
    for (const cell of cells) {
      const at = cell.games.indexOf(game);
      if (at >= 0 && cell.degree[at] > degree) { best = cell.key; degree = cell.degree[at]; }
    }
    if (best) seeded.set(best, [...(seeded.get(best) ?? []), game]);
  }

  const results = allocate(ix, scorer, cells, {
    capacity, seeded, rejected: new Set(rowsOf(banned)), alternatesLimit, gainFloor,
  });

  const ownedRows = new Set(rowsOf(owned));
  return {
    ix, rows, cells: results,
    data: toGridData(ix, results, cells, rows, columns),
    grid: results.map((cell) => ({
      ...cell,
      picks: cell.picks.map((g, i) => ({
        id: ix.ids[g], name: ix.names[g], rank: ix.rank[g],
        gain: cell.gains[i], owned: ownedRows.has(g),
      })),
      alternates: cell.alternates.map((g) => ({ id: ix.ids[g], name: ix.names[g] })),
    })),
  };
}
