/**
 * The selection engine: everything the grid needs, from the contract alone.
 *
 * The model is upstream and offline; this is the part that re-runs whenever a
 * reader changes something. It knows nothing about how genres were discovered —
 * only what the contract says they are.
 */

export { indexContract } from './contract.js';
export { ratingSpans, coverageWeights } from './quality.js';
export { buildWeightRows, buildCells, playerAxis, weightAxis } from './membership.js';
export { readDepth, axisDepths, gridDepths, PROBE } from './depth.js';
export { CoverageScorer } from './scorer.js';
export { allocate, UNIT_COST } from './allocate.js';
export { toGridData } from './present.js';
export { explainCut, cutSentence, howAlike, similarityBetween } from './explain.js';
export { analyseShelf, coverageOf, redundancies, spokeVector } from './shelf.js';

import { indexContract } from './contract.js';
import { ratingSpans, coverageWeights } from './quality.js';
import { buildWeightRows, buildCells, playerAxis, weightAxis } from './membership.js';
import { collectionCurve, gridDepths, readDepth, seedInto } from './depth.js';

/** Deep enough for the whole-corpus curve to fall; never a cap on the answer. */
export const COLLECTION_PROBE = 120;
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
  axes = ['players', 'weight'],
  columns = DEFAULT_COLUMNS, rowCount = 5, rowNames = DEFAULT_ROW_NAMES, rowEdges = null,
  capacity = 'auto', alternatesLimit = 6, depthOverrides = {}, autoDepthLeftover = null,
  owned = [], keepers = [], banned = [], budget = null, costOf = null,
  perShelfCap = null,
  genreWeights = null, include = null, gainFloor = null, policy = null,
} = {}) {
  const base = contract.games ? indexContract(contract) : contract;
  // Policy travels with the model, so overriding it is a *test* affordance and
  // a sweep affordance — never something the interface exposes.
  const ix = policy ? { ...base, policy: { ...base.policy, ...policy } } : base;

  const defaults = base.defaults ?? {};
  const weights = coverageWeights(ix, include ? ratingSpans(ix, include) : null);
  const rows = buildWeightRows(
    include ? [...ix.weight].filter((_, g) => include[g]) : ix.weight,
    rowCount, rowNames, rowEdges);

  // `axes` is the whole difference between the collection and the grid. Empty
  // is one cell holding everything; one axis gives columns; two gives cells.
  const onPlayers = axes.includes('players');
  const onWeight = axes.includes('weight');
  const axisList = [
    ...(onPlayers ? [playerAxis(columns)] : []),
    ...(onWeight ? [weightAxis(rows)] : []),
  ];
  const cells = buildCells(ix, { axes: axisList, include });
  const scorer = new CoverageScorer(ix, weights, cells, { genreWeights });

  // Depth is read from each axis's own curve unless a number was given. With no
  // axes there is nothing to read down, so the collection stops on the gain
  // floor and the ceiling only has to be out of the way.
  const rowsOf = (ids) => ids.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
  const rejectedRows = new Set(rowsOf(banned));
  const keeperRows = rowsOf(keepers);

  let depths = null;
  let room = capacity;
  let probeCell = null;    // the unsplit curve, for naming what comes next
  if (capacity === 'auto') {
    const leftover = autoDepthLeftover ?? defaults.autoDepthLeftover ?? 0.45;
    const fallback = defaults.picksPerCell ?? 5;
    if (axisList.length === 0) {
      // One cell, so there is no column or row to read down — read the cell
      // itself. Probe deep enough that the curve has somewhere to fall, cut it,
      // then allocate again at that depth: the capacity is what the allocator
      // fills toward, so truncating a deeper run is not the same thing.
      // On its own pools: `allocate` fills `cell.chosen`, so probing the cells
      // the real run is about to use hands it a shelf that is already full.
      const probe = collectionCurve(ix, weights, {
        gainFloor, genreWeights, include, probe: COLLECTION_PROBE,
      });
      probeCell = probe;
      const read = readDepth(probe?.gains ?? [],
        { leftover, fallback, places: ix.policy.gainPlaces ?? 3 });
      // The unsplit collection takes an override like any other shelf, under
      // the key `collection` — there is no column or row to name it by.
      const set = depthOverrides.collection;
      room = set == null ? read.depth : Math.max(0, Math.min(COLLECTION_PROBE, set));
      // The curve past the cut is kept: showing where it fell is the only
      // honest way to say why the collection is the size it is.
      depths = {
        capacity: room, columnDepth: new Map(), rowDepth: new Map(),
        cell: {
          ...read, depth: room, auto: set == null, read: read.depth,
          // How much the next game would add, so a button can say whether it is
          // worth pressing rather than only that it exists.
          next: probe?.gains?.[room] ?? null,
          nextName: probe?.picks?.[room] == null
            ? null : ix.names[probe.picks[room]],
          curve: (probe?.gains ?? []).slice(0, 24),
        },
      };
    } else {
      depths = gridDepths(ix, weights, {
        columns: onPlayers ? columns : null,
        rows: onWeight ? rows : null,
        leftover, fallback, overrides: depthOverrides, genreWeights, include,
        places: ix.policy.gainPlaces ?? 3,
        perShelfCap,
      });
      room = depths.capacity;
    }
  }

  // The flat default is resolved inside `gridDepths`, where a number typed on
  // one shelf can still beat it. The unsplit collection has no column or row to
  // resolve against, so it is applied here — and the number typed on that one
  // shelf beats it the same way.
  if (perShelfCap != null && axisList.length === 0 && depthOverrides.collection == null) {
    room = Math.min(room, perShelfCap);
  }
  // What comes next depends on where it stopped, so it is named after every
  // ceiling has had its say rather than off the reading alone.
  if (depths?.cell && probeCell) {
    depths = {
      ...depths,
      capacity: room,
      cell: {
        ...depths.cell,
        depth: room,
        next: probeCell.gains?.[room] ?? null,
        nextName: probeCell.picks?.[room] == null ? null : ix.names[probeCell.picks[room]],
      },
    };
  }

  /**
   * Pin what did not make it, and only that.
   *
   * Seeding a game hands it a slot before any bidding, which takes it out of
   * contention for every other cell that wanted it — so the whole contest
   * resolves differently. Pinning a game that was *already* the first pick of
   * its shelf changed three games in the collection and moved seven to other
   * shelves, which is nonsense: it was already staying.
   *
   * So allocate first, then seed only the keepers that lost, and allocate
   * again. A pin on something already shelved is now the no-op it reads as.
   */
  const run = (seeded) => {
    const pools = seeded ? buildCells(ix, { axes: axisList, include }) : cells;
    const with_ = seeded ? new CoverageScorer(ix, weights, pools, { genreWeights }) : scorer;
    return {
      pools,
      results: allocate(ix, with_, pools, {
        capacity: room, seeded: seeded ?? new Map(),
        rejected: rejectedRows, alternatesLimit, gainFloor,
        budget, ...(costOf ? { costOf } : {}),
      }),
    };
  };

  let { pools, results } = run(null);
  if (keeperRows.length) {
    // Seeding one pin can displace another — seeding Jaws of the Lion pushed
    // Gloomhaven out, and both were meant to be held. So accumulate: whoever is
    // still missing joins the seed set and the whole thing runs again, until
    // every pin is in or a pass stops adding to the set.
    const seed = new Set();
    for (let pass = 0; pass <= keeperRows.length; pass++) {
      const shelved = new Set(results.flatMap((c) => c.picks));
      const missing = keeperRows.filter((g) => !shelved.has(g) && !seed.has(g));
      if (!missing.length) break;
      for (const g of missing) seed.add(g);
      ({ pools, results } = run(seedInto(pools, [...seed])));
    }
  }

  const ownedRows = new Set(rowsOf(owned));
  let lazyData = null;
  return {
    ix, rows, axes, depths, columns,
    // `cells` are the candidate pools with their weights; `results` is what the
    // allocation made of them. Both are wanted — explaining why a game was cut
    // needs the pools, which say what it could ever have reached.
    cells: pools, results, weights,
    // The `grid.json` shape, for anyone who wants it — computed when it is asked
    // for and not before. Nothing in the interface reads it, and building it
    // eagerly was 285ms of every rebuild on the live corpus: more than the
    // allocation it describes. It only means anything when both axes are on.
    get data() {
      if (!onPlayers || !onWeight) return null;
      if (!lazyData) lazyData = toGridData(ix, results, pools, rows, columns);
      return lazyData;
    },
    grid: results.map((cell) => ({
      ...cell,
      picks: cell.picks.map((g, i) => ({
        id: ix.ids[g], name: ix.names[g], rank: ix.rank[g],
        gain: cell.gains[i], owned: ownedRows.has(g),
      })),
      alternates: cell.alternates.map((g, i) => ({
        id: ix.ids[g], name: ix.names[g], rank: ix.rank[g],
        gain: cell.alternateGains?.[i] ?? null,
      })),
    })),
  };
}
