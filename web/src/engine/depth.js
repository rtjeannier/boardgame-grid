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
 * The cut in one gain sequence.
 *
 * `leftover` is the whole rule: the sharpest fall only counts as a stopping
 * point when what the next game would still have added is under this share of
 * what the first one added. Without it the rule fires on smooth curves and
 * leaves real value behind.
 */
export function readDepth(gains, { leftover, fallback, places = 3 }) {
  // Read at the precision both engines publish, never at whatever this one
  // happens to hold. Python reports a gain to `policy.gainPlaces`, and reading
  // full precision here cuts the weight-3 row at 10 where Python cuts at 8 —
  // two drops that tie at 0.120 once rounded. Ties keep the earlier index.
  const round = (v) => Math.round(v * 10 ** places) / 10 ** places;
  const g = [...gains].filter((v) => v != null).map(round);
  if (g.length < 4) return { depth: g.length, auto: true, left: 0 };

  let widest = -Infinity;
  let at = 1;
  for (let i = 1; i < g.length; i++) {
    const drop = g[i - 1] - g[i];
    if (drop > widest) { widest = drop; at = i; }
  }
  const left = g[0] > 0 ? g[at] / g[0] : 1;
  return left <= leftover
    ? { depth: at, auto: true, left }
    : { depth: fallback, auto: false, left };
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
  const results = allocate(ix, scorer, cells, { capacity: probe, alternatesLimit: 0 });
  const out = new Map();
  for (const cell of results) {
    out.set(cell.key,
      { ...readDepth(cell.gains, { leftover, fallback, places }), key: cell.key });
  }
  return out;
}

/**
 * Depth for every cell of a grid, as the allocator wants it.
 *
 * A cell takes the smaller of its column's answer and its row's, because both
 * are ceilings — the same rule `Collection.capacity()` applies on the Python
 * side. `overrides` is what the reader typed, and it beats both.
 */
export function gridDepths(ix, weights, { columns, rows, leftover, fallback, places,
  overrides = {}, probe = PROBE, genreWeights = null, include = null } = {}) {
  const opts = { leftover, fallback, places, probe, genreWeights, include };
  const byColumn = columns ? axisDepths(ix, weights, playerAxis(columns), opts) : null;
  const byRow = rows ? axisDepths(ix, weights, weightAxis(rows), opts) : null;

  const depthOf = (map, key, kind) => {
    const set = overrides[`${kind}:${key}`];
    if (set != null) return { depth: set, auto: false, read: map?.get(key)?.depth ?? null };
    const read = map?.get(key);
    return { depth: read?.depth ?? fallback, auto: read?.auto ?? false, read: read?.depth ?? null };
  };

  const columnDepth = new Map(
    (columns ?? []).map((c) => [c.label, depthOf(byColumn, c.label, 'column')]));
  const rowDepth = new Map(
    (rows ?? []).map((r) => [String(r.index), depthOf(byRow, String(r.index), 'row')]));

  const capacity = new Map();
  for (const [label, c] of columnDepth) {
    if (!rows) { capacity.set(label, c.depth); continue; }
    for (const [index, r] of rowDepth) {
      capacity.set(`${label}|${index}`, Math.min(c.depth, r.depth));
    }
  }
  if (!columns && rows) for (const [index, r] of rowDepth) capacity.set(index, r.depth);

  return { capacity, columnDepth, rowDepth };
}
