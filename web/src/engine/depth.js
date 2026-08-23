/**
 * How deep a shelf goes, read from its own curve rather than chosen.
 *
 * A shelf fills in order of what each game still adds, and that sequence falls
 * away as the ground gets covered. Where it falls off a cliff, that is where the
 * shelf wants to stop. Where it slopes, there is nothing to find and the number
 * a reader set applies instead — and the interface says which happened.
 *
 * Read once per axis, never per cell. Measured on the seed corpus: thirty-five
 * five-pick sequences give a median depth of 1 with one cell at 19, which is
 * noise. Read down the seven player columns instead and the answers are 5, 6,
 * 11, 10, 3 and 1 — nine-plus wanting a single game because after the best one
 * there the next is worth a quarter as much.
 */

import { allocate } from './allocate.js';
import { buildCells, playerAxis, weightAxis } from './membership.js';
import { CoverageScorer } from './scorer.js';

/**
 * Deep enough that the curve has somewhere to fall. Never a cap on the answer.
 *
 * Measured on the live corpus, one column axis: 133ms at 12, 265ms at 20, 586ms
 * at 30, 1,133ms at 40 — superlinear, because every unit of capacity is another
 * bid round scoring every candidate in every bucket. Twenty and forty return
 * identical depths on all seven columns; twelve does not.
 *
 * Deliberately fixed rather than grown until a crossing appears. The probe is
 * not a passive observation: it is an allocation, and an axis's buckets contend
 * for the same games, so a deeper probe observes a *bigger collection* and the
 * curves themselves move. That is why twelve disagrees with twenty on the
 * nine-plus column even though the answer there is one — its first pick differs.
 * An adaptive probe would measure different buckets against different
 * collections, which is not a comparison.
 */
export const PROBE = 20;

/**
 * One cached reading per axis, per index.
 *
 * `axisDepths` was 90% of every rebuild — 1,433ms of 1,592ms on the live corpus
 * — and almost nothing a reader touches changes its answer. Pins, ownership,
 * depth overrides and fill limits leave it identical by construction; bans are
 * excluded from it on purpose (see `axisDepths`), so what is left is the axis
 * itself.
 */
const CACHE = new WeakMap();

function cached(ix, key, make) {
  let byKey = CACHE.get(ix);
  if (!byKey) { byKey = new Map(); CACHE.set(ix, byKey); }
  if (!byKey.has(key)) byKey.set(key, make());
  return byKey.get(key);
}

/**
 * Where one shelf stops.
 *
 * It keeps taking games while the next still adds at least `leftover` of what
 * the first one added, and stops at the first that does not. That is the whole
 * rule, and it is deliberately not "cut at the sharpest fall": the sharpest
 * fall is a single argmax over the sequence, so removing one game can move it
 * anywhere. Blocking Dune: Imperium swung a column from eleven to five, because
 * the largest drop relocated and the old rule then declined to use it at all.
 *
 * A threshold on the level is monotone instead — ban a game and the crossing
 * point shifts by a place or two, never across the shelf. It also never
 * declines, so there is no second rule to explain and no "fell back" to read.
 */
export function readDepth(gains, { leftover, fallback, places = 3 }) {
  // Read at the precision both engines publish, never at whatever this one
  // happens to hold. Python reports a gain to `policy.gainPlaces`; reading full
  // precision here puts the two engines out of step over ties.
  const round = (v) => Math.round(v * 10 ** places) / 10 ** places;
  const g = [...gains].filter((v) => v != null).map(round);
  if (!g.length) return { depth: 0, auto: true, bar: 0, next: null };

  const bar = round(leftover * g[0]);
  let depth = 0;
  while (depth < g.length && g[depth] > bar) depth++;
  if (!depth) depth = Math.min(1, g.length);
  return { depth, auto: true, bar, next: g[depth] ?? null, fallback };
}

/**
 * Read every bucket of one axis at once.
 *
 * Runs the allocation with that axis alone and a generous ceiling, which is the
 * only way to see the curve: a shelf capped at five never shows what its sixth
 * pick would have been worth.
 */
export function axisDepths(ix, weights, axis, {
  leftover, fallback, places, probe = PROBE, genreWeights = null, include = null,
} = {}) {
  const cells = buildCells(ix, { axes: [axis], include });
  const scorer = new CoverageScorer(ix, weights, cells, { genreWeights });
  // No bans, no pins. A shelf's depth is set by the axis and nothing else, so
  // blocking a game changes *which* games fill the shelves and never *how many*
  // — the grid keeps its shape while its contents move. Exactness would argue
  // the other way, since a banned game really is unavailable; but blocking one
  // game moved the 1-player column 5 -> 6 and the 3-player column 9 -> 8, and
  // every shelf below them reflowed for a reason nobody could see.
  const results = allocate(ix, scorer, cells, { capacity: probe, alternatesLimit: 0 });
  const out = new Map();
  for (const cell of results) {
    out.set(cell.key,
      { ...readDepth(cell.gains, { leftover, fallback, places }), key: cell.key });
  }
  return out;
}

/** Each pinned game into the bucket of this axis it belongs to most. */
export function seedInto(cells, keepers) {
  const seeded = new Map();
  for (const game of keepers) {
    let best = null, degree = -1;
    for (const cell of cells) {
      const at = cell.games.indexOf(game);
      if (at >= 0 && cell.degree[at] > degree) { best = cell.key; degree = cell.degree[at]; }
    }
    if (best != null) seeded.set(best, [...(seeded.get(best) ?? []), game]);
  }
  return seeded;
}

/**
 * Depth for every cell of a grid, as the allocator wants it.
 *
 * A cell takes the smaller of its column's answer and its row's, because both
 * are ceilings — the same rule `Collection.capacity()` applies on the Python
 * side. `overrides` is what the reader typed, and it beats both.
 */
export function gridDepths(ix, weights, { columns, rows, leftover, fallback, places,
  overrides = {}, probe = PROBE, genreWeights = null, include = null,
  perShelfCap = null } = {}) {
  const opts = { leftover, fallback, places, probe, genreWeights, include };
  // Keyed on what the reading actually depends on. `include` filters the corpus
  // and is rare, so a filtered build simply does not cache.
  const read = (kind, axis, shape) => (include
    ? axisDepths(ix, weights, axis, opts)
    : cached(ix, `${kind}|${shape}|${leftover}|${fallback}|${places}|${probe}`
      + `|${genreWeights ? JSON.stringify(genreWeights) : ''}`,
    () => axisDepths(ix, weights, axis, opts)));

  const byColumn = columns
    ? read('col', playerAxis(columns), JSON.stringify(columns)) : null;
  const byRow = rows
    ? read('row', weightAxis(rows), JSON.stringify(rows.map((r) => [r.lo, r.hi]))) : null;

  const depthOf = (map, key, kind) => {
    const read = map?.get(key);
    const set = overrides[`${kind}:${key}`];
    if (set != null) {
      return { depth: set, auto: false, set: true, read: read?.depth ?? null, bar: read?.bar };
    }
    return {
      depth: read?.depth ?? fallback,
      auto: read?.auto ?? false,
      set: false,
      read: read?.depth ?? null,
      bar: read?.bar,
    };
  };

  const columnDepth = new Map(
    (columns ?? []).map((c) => [c.label, depthOf(byColumn, c.label, 'column')]));
  const rowDepth = new Map(
    (rows ?? []).map((r) => [String(r.index), depthOf(byRow, String(r.index), 'row')]));

  // A shelf takes the smaller of its column's answer and its row's, unless the
  // reader has said otherwise about that one shelf. Per-cell beats both, because
  // it is the most specific thing anybody said.
  const capacity = new Map();
  const cellDepth = new Map();
  const resolve = (key, from) => {
    // The flat default is a ceiling on what the reading said — but only where
    // the reader has not spoken. A number typed on one shelf is the most
    // specific thing anybody said about that shelf and beats both.
    const base = perShelfCap == null ? from : Math.min(from, perShelfCap);
    const set = overrides[`cell:${key}`];
    const depth = set == null ? base : Math.max(0, set);
    capacity.set(key, depth);
    cellDepth.set(key, { depth, auto: set == null, from });
  };

  for (const [label, c] of columnDepth) {
    if (!rows) { resolve(label, c.depth); continue; }
    for (const [index, r] of rowDepth) {
      resolve(`${label}|${index}`, Math.min(c.depth, r.depth));
    }
  }
  if (!columns && rows) for (const [index, r] of rowDepth) resolve(index, r.depth);

  return { capacity, columnDepth, rowDepth, cellDepth };
}

/**
 * The unsplit collection's own curve, cached like the axis readings.
 *
 * One cell, so there is no axis to read down — the cell is read instead, and the
 * same argument applies: nothing a reader touches moment to moment changes it,
 * so it should not be recomputed on every keystroke.
 */
export function collectionCurve(ix, weights, {
  gainFloor = null, genreWeights = null, include = null, probe = 120,
} = {}) {
  const make = () => {
    // On its own pools: `allocate` fills `cell.chosen`, so probing the cells the
    // real run is about to use hands it a shelf that is already full.
    const cells = buildCells(ix, { axes: [], include });
    const scorer = new CoverageScorer(ix, weights, cells, { genreWeights });
    const [cell] = allocate(ix, scorer, cells, { capacity: probe, alternatesLimit: 0, gainFloor });
    return cell ? { gains: cell.gains, picks: cell.picks } : null;
  };
  if (include) return make();
  return cached(ix, `collection|${probe}|${gainFloor}`
    + `|${genreWeights ? JSON.stringify(genreWeights) : ''}`, make);
}
