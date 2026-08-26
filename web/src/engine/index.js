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
export {
  analyseShelf, coverageOf, overRepresented, redundancies, spokeVector,
} from './shelf.js';

import { indexContract } from './contract.js';
import { ratingSpans, coverageWeights } from './quality.js';
import { buildWeightRows, buildCells, playerAxis, weightAxis } from './membership.js';
import { collectionCurve, dealInto, gridDepths, readDepth, seedInto } from './depth.js';

/** Deep enough for the whole-corpus curve to fall; never a cap on the answer. */
export const COLLECTION_PROBE = 120;
import { CoverageScorer } from './scorer.js';
import { allocate, roomFor } from './allocate.js';
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
export function buildGrid(contract, options = {}) {
  const {
  axes = ['players', 'weight'],
  columns = DEFAULT_COLUMNS, rowCount = 5, rowNames = DEFAULT_ROW_NAMES, rowEdges = null,
  capacity = 'auto', alternatesLimit = 6, depthOverrides = {}, autoDepthLeftover = null,
  owned = [], keepers = [], banned = [], budget = null, costOf = null,
  perShelfCap = null, held = null, heldAt = null, fill = false, confineTo = null,
  genreWeights = null, include = null, gainFloor = null, policy = null,
  } = options;
  const base = contract.games ? indexContract(contract) : contract;
  // Policy travels with the model, so overriding it is a *test* affordance and
  // a sweep affordance — never something the interface exposes.
  const ix = policy ? { ...base, policy: { ...base.policy, ...policy } } : base;

  const defaults = base.defaults ?? {};
  const rowsOf = (ids) => ids.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
  // `confineTo` shuts the corpus down to a list of games without touching the
  // rating spans the way `include` does — filtering the corpus rescales genre
  // quality, which is right for a reader's filter and wrong for "choose among
  // the games I already hold". Every shelf then picks freely from that list, so
  // a shelf that has to give games up gives up the ones it values least rather
  // than the ones that happen to sit at the end of an array.
  //
  // It shrinks the candidate pools rather than rejecting out of full ones.
  // Rejection leaves `scoreAll` scoring all five thousand games in every cell
  // to find the two hundred that are eligible, which cost 750ms on a press of
  // "fit the shelves"; the pools do the same job for the cost of building them.
  let confined = null;
  if (confineTo) {
    const keep = rowsOf(confineTo);
    confined = new Uint8Array(ix.names.length);
    for (const g of keep) confined[g] = 1;
    if (include) for (let g = 0; g < confined.length; g++) if (!include[g]) confined[g] = 0;
  }

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
  const cells = buildCells(ix, { axes: axisList, include: confined ?? include });
  const scorer = new CoverageScorer(ix, weights, cells, { genreWeights });

  // Depth is read from each axis's own curve unless a number was given. With no
  // axes there is nothing to read down, so the collection stops on the gain
  // floor and the ceiling only has to be out of the way.
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
    room = perShelfCap;
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
   * Splitting deals the collection out. It does not choose a new one.
   *
   * Without this, turning on an axis threw the collection away and allocated
   * again from the whole corpus: splitting twelve games by player count put
   * fifty-eight on the screen, of which forty-seven had never been in the
   * collection. Eleven of the original twelve did survive, so nothing was
   * really being *replaced* — they were being buried, in one frame, which is
   * what made it unreadable.
   *
   * So a shelf nobody has spoken about takes exactly what it was dealt, by the
   * same rule a pin lands by: the bucket of this axis it belongs to most. A
   * shelf that *was* spoken about — a number typed on it, on its column or row,
   * or in the register — fills to that number from the whole corpus, because
   * asking for eight games is an ask and should not wait for a second button.
   *
   * `held` is null for a collection that has not been dealt: filling is what
   * clears it, and then every shelf fills to its depth again.
   */
  let dealt = null;
  if (held != null) {
    const wasAt = heldAt
      ? new Map([...heldAt]
        .map(([id, key]) => [ix.rowOf.get(id), key])
        .filter(([g]) => g !== undefined))
      : null;
    const byCell = dealInto(cells, rowsOf(held), wasAt);
    const asked = room;
    // Filling is asking every shelf at once for the depth it reads, and it is
    // still a top-up rather than a fresh start: the deal stays seeded, so
    // nothing you were holding is dropped to make room for something better.
    // Clearing `held` instead re-ran the whole allocation and lost one of the
    // twelve — a game leaving because you pressed *fill* reads as a bug.
    // With no axes there is one shelf and no column or row to have spoken
    // through, so the only things that count are the number typed on the
    // collection itself and the one in the register. Unsplitting therefore
    // *gathers*: the single shelf takes everything the grid was holding rather
    // than reading its curve and dropping two hundred and sixty games.
    const spokenFor = (key) => fill || (axisList.length === 0
      ? (depthOverrides.collection != null || perShelfCap != null)
      : (depths?.cellDepth?.get(key)?.spoken ?? (capacity !== 'auto')));
    dealt = new Map();
    room = new Map(cells.map((c) => {
      const mine = byCell.get(c.key) ?? [];
      // A shelf keeps what it was dealt, and a shelf that was asked for a
      // number gets that number. Both at once: seed the deal, but never more of
      // it than was asked for. Seeding all of it would make the ask
      // unanswerable downwards — a seeded game is in before any bidding, so
      // asking a shelf of three for one left all three. Seeding none of it lets
      // the auction reassign what the shelf already had: asking one cell for
      // five swapped out two of the three it was holding.
      //
      // Which two it would have dropped is not arbitrary: `held` arrives in the
      // order the collection chose, best first, and `dealInto` keeps that
      // order, so the first `n` are the ones the shelf has most reason to hold.
      const room = spokenFor(c.key) ? roomFor(asked, c.key) : mine.length;
      const keep = mine.slice(0, room);
      if (keep.length) dealt.set(c.key, keep);
      return [c.key, room];
    }));
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
    const pools = seeded ? buildCells(ix, { axes: axisList, include: confined ?? include }) : cells;
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

  let { pools, results } = run(dealt);
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
  let lazyFilled = null;
  const built = {
    ix, rows, axes, depths, columns,
    // `cells` are the candidate pools with their weights; `results` is what the
    // allocation made of them. Both are wanted — explaining why a game was cut
    // needs the pools, which say what it could ever have reached.
    cells: pools, results, weights,
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

  /**
   * Two whole builds, hidden behind getters — and deliberately not enumerable.
   *
   * Spreading an object *invokes* its getters, so `{ ...built, mineOnly }` in a
   * standfirst ran a second `buildGrid` on every render: 699 of the 734
   * `scoreAll` calls behind one click came from `get filled`, and blocking a
   * game took 586ms instead of 133ms. Non-enumerable means a spread cannot
   * reach them at all, which is a property of the object rather than a rule
   * somebody has to remember.
   */
  Object.defineProperties(built, {
    // The `grid.json` shape, for anyone who wants it — computed when it is
    // asked for and not before. Nothing in the interface reads it, and building
    // it eagerly was 285ms of every rebuild: more than the allocation it
    // describes. It only means anything when both axes are on.
    data: {
      enumerable: false,
      get() {
        if (!onPlayers || !onWeight) return null;
        if (!lazyData) lazyData = toGridData(ix, results, pools, rows, columns);
        return lazyData;
      },
    },
    /**
     * What the collection would hold if every shelf filled to its depth.
     *
     * Two passes, because fitting is two questions. First, which of the games
     * you hold does each shelf keep? Dropping a band merges two shelves into
     * one that then holds more than it reads, and the answer has to come from
     * the scorer — trimming by position deleted whatever had just been
     * re-homed. Second, what fills the room that is left, from the whole
     * corpus. It returns `{ ids, at }` because what it is *for* is becoming the
     * next `held`: filling leaves the collection dealt, not undealt, so the
     * grid stays still afterwards. A Map, because game ids are numbers and an
     * object key would stringify them.
     */
    filled: {
      enumerable: false,
      get() {
        if (!lazyFilled) {
          const within = held == null ? null
            : buildGrid(base, { ...options, fill: true, alternatesLimit: 0,
                                confineTo: held, held: null, heldAt: null });
          const start = within && {
            held: within.grid.flatMap((c) => c.picks.map((p) => p.id)),
            heldAt: new Map(
              within.grid.flatMap((c) => c.picks.map((p) => [p.id, c.key]))),
          };
          const full = buildGrid(base, { ...options, fill: true, alternatesLimit: 0,
                                         ...(start ?? {}) });
          lazyFilled = {
            ids: full.grid.flatMap((c) => c.picks.map((p) => p.id)),
            at: new Map(full.grid.flatMap((c) => c.picks.map((p) => [p.id, c.key]))),
          };
        }
        return lazyFilled;
      },
    },
  });
  return built;
}
