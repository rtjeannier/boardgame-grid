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

/**
 * Each held game back into the cell it was already in, where that still exists.
 *
 * `seedInto` answers "where does this game belong", which is the right question
 * for a pin and for the first split, and the wrong one for a game that is
 * already on a shelf: the auction puts a game where it *won*, which is not
 * always the bucket it loads onto most. Dealing purely by belonging moved 101
 * of 272 games to a different cell the moment the collection was re-dealt, so
 * pressing "fill the shelves" settled and then jumped.
 *
 * A key that no longer names a cell simply falls through to belonging, which is
 * what happens on every axis change — the old placement cannot mean anything
 * once the cells are different.
 */
export function dealInto(cells, keepers, at = null) {
  if (!at) return seedInto(cells, keepers);
  const known = new Map(cells.map((c) => [c.key, c]));
  const out = new Map();
  const strays = [];
  for (const game of keepers) {
    const key = at.get(game);
    const cell = key == null ? null : known.get(key);
    if (cell && cell.games.includes(game)) {
      out.set(key, [...(out.get(key) ?? []), game]);
    } else {
      strays.push(game);
    }
  }
  for (const [key, games] of seedInto(cells, strays)) {
    out.set(key, [...(out.get(key) ?? []), ...games]);
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
 * Which arrangement a typed depth was typed under.
 *
 * Cell keys are only unique *within* an arrangement. With one axis on a cell
 * key is a bare string — a column label under `players`, a row index under
 * `weight` — so the 3-players column and weight band 3 are both `"3"`, and an
 * override typed on one silently became the depth of the other. Measured: type
 * 25 on the 3-players column, drop players, add weight, and band 3 held 25
 * games while reading 25, so "fit the shelves" agreed with it and never offered
 * to trim. That is the 20-game shelf a fit would not touch.
 *
 * Naming the key rather than pruning it keeps the property the comment in
 * `ui/state.js` is about: a depth you set outlives the arrangement you set it
 * under, and comes back when you return to that arrangement.
 */
/**
 * The `depthOverrides` key for one shelf, and the only place that spells it.
 *
 * With both axes on a cell key is `"4|2"`, which names its column and its row
 * and can be read only one way — and it is the form `pipeline/depth.py` mirrors
 * and `tests/parity` asserts, so it has to stay exactly that. Only the
 * single-axis keys are ambiguous, and only those take the axis's name. The
 * `column:` and `row:` keys need none of this: they are already told apart by
 * their prefix, and they are the same cross-engine contract.
 */
export const cellOverrideKey = (axes = [], key) =>
  `cell:${axes.length === 1 ? `${axes[0]}:` : ''}${key}`;

/**
 * Depth for every cell of a grid, as the allocator wants it.
 *
 * A cell takes the smaller of its column's answer and its row's — the same rule
 * `Collection.capacity()` applies on the Python side — and anything the reader
 * typed about that one cell beats both. See `resolve` for the four layers and
 * which of them displaces which.
 */
export function gridDepths(ix, weights, { columns, rows, leftover, fallback, places,
  overrides = {}, probe = PROBE, genreWeights = null, include = null,
  perShelfCap = null } = {}) {
  const opts = { leftover, fallback, places, probe, genreWeights, include };
  // `columns` and `rows` *are* the axis set: either is null when its axis is
  // off. So the scope a typed depth belongs to needs no extra parameter.
  // Named `axisKeys`, not `axes`: `resolve` below takes its own `...axes` rest
  // of depth readings, and the shadowing silently keyed every single-axis
  // override under `cell:[object Object]:3`.
  const axisKeys = [...(columns ? ['players'] : []), ...(rows ? ['weight'] : [])];
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

  // `depth` is what the axis is actually doing, so a header shows the truth
  // rather than a number it is not using: with the register set to 5, a column
  // whose curve reads 9 holds five games and used to say nine. `read` keeps the
  // curve's own answer, which is what "back to what the shelf reads" restores.
  const depthOf = (map, key, kind) => {
    const curve = map?.get(key);
    const reading = curve?.depth ?? fallback;
    const set = overrides[`${kind}:${key}`];
    if (set != null) {
      return { depth: set, auto: false, set: true, read: reading, bar: curve?.bar };
    }
    return {
      depth: perShelfCap ?? reading,
      auto: curve?.auto ?? false,
      set: false,
      read: reading,
      bar: curve?.bar,
    };
  };

  const columnDepth = new Map(
    (columns ?? []).map((c) => [c.label, depthOf(byColumn, c.label, 'column')]));
  const rowDepth = new Map(
    (rows ?? []).map((r) => [String(r.index), depthOf(byRow, String(r.index), 'row')]));

  // Depth is a guide at every level and a ceiling at none. Four layers, most
  // specific answer wins, every one of them optional:
  //
  //     cell override      what you typed or clicked on this shelf
  //     column / row       what you typed on that header
  //     perShelfCap        what you typed in the register
  //     the reading        what the shelf's own curve says
  //
  // `perShelfCap` used to *replace* `from` outright, which threw away the layer
  // holding the column and row overrides: with the register set to 5, typing 9
  // on a column changed nothing and never said why. So it now displaces
  // readings only — typing on either axis takes a cell out of its reach, and
  // the two axes go on resolving by the smaller of the pair as they always did.
  const capacity = new Map();
  const cellDepth = new Map();
  const resolve = (key, ...axes) => {
    // A typed axis takes the cell out of the register's reach; an untyped one
    // falls back to its own curve rather than to the register, which would
    // otherwise reimpose the number the reader just typed over.
    const typed = axes.some((a) => a.set);
    const from = Math.min(...axes.map((a) => (typed && !a.set ? a.read : a.depth)));
    const set = overrides[cellOverrideKey(axisKeys, key)];
    const depth = set == null ? from : Math.max(0, set);
    capacity.set(key, depth);
    // `spoken` is whether a reader has said anything at all about how deep this
    // shelf goes, at any of the three levels. A deal fills a shelf nobody has
    // spoken about with what it was dealt and leaves the rest to the number
    // that was asked for — see `buildGrid`.
    cellDepth.set(key, {
      depth, auto: set == null, set: set != null, from,
      spoken: set != null || typed || perShelfCap != null,
    });
  };

  for (const [label, c] of columnDepth) {
    if (!rows) { resolve(label, c); continue; }
    for (const [index, r] of rowDepth) resolve(`${label}|${index}`, c, r);
  }
  if (!columns && rows) for (const [index, r] of rowDepth) resolve(index, r);

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
