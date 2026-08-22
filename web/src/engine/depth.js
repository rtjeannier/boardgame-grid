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

/** Deep enough that the curve has somewhere to fall; never a cap on the answer. */
export const PROBE = 40;

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
  rejected = null,
} = {}) {
  const cells = buildCells(ix, { axes: [axis], include });
  const scorer = new CoverageScorer(ix, weights, cells, { genreWeights });
  // Bans move the curve; pins do not.
  //
  // A banned game is genuinely not available, so the shelf below it really does
  // fill differently and the point where returns fall away really does move. A
  // pinned game is still one of the candidates — pinning only says it must be
  // among them. Seeding it into the probe makes it contribute its coverage
  // first, which flattens every gain after it and drags the knee an entry
  // earlier: pin any game at all and the collection quietly shrank from twelve
  // to eleven. That was an artefact of the measurement, not a finding about the
  // collection.
  const results = allocate(ix, scorer, cells, {
    capacity: probe, alternatesLimit: 0, rejected: rejected ?? undefined,
  });
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
  rejected = null } = {}) {
  const opts = { leftover, fallback, places, probe, genreWeights, include, rejected };
  const byColumn = columns ? axisDepths(ix, weights, playerAxis(columns), opts) : null;
  const byRow = rows ? axisDepths(ix, weights, weightAxis(rows), opts) : null;

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
    const set = overrides[`cell:${key}`];
    const depth = set == null ? from : Math.max(0, set);
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
