/**
 * Where a game sits on the grid, by degree.
 *
 * A game does not live in one cell. Both axes are fuzzy — the player poll
 * endorses several counts, and weight rows are quantile cuts through a
 * continuous number — so membership is a degree in (0, 1] and the product
 * across axes scales everything the game contributes.
 *
 * The axes themselves are the reader's, not the model's: columns are ranges
 * over `playerFit` and rows are quantiles of the population. Both are rebuilt
 * here on every change, which is why neither is in the contract.
 */

/** Interior cut points splitting the population into `count` equal parts. */
function weightRowEdges(weights, count) {
  const ordered = Float64Array.from(weights).sort();
  const n = ordered.length;
  const edges = [];
  for (let k = 1; k < count; k++) {
    // Nearest-rank percentile, matching the Python. `Math.round` differs from
    // Python's banker's rounding only at exact .5, which a k/count*n product
    // essentially never hits — but it is rounded to 2dp after, as there.
    const idx = Math.min(n - 1, Math.round((k / count) * n));
    edges.push(Math.round(ordered[idx] * 100) / 100);
  }
  return edges;
}

/**
 * `edges` overrides the quantile cuts.
 *
 * The defaults are quantiles so every band holds a comparable number of games,
 * which is why they are computed rather than chosen. A reader who moves one is
 * giving that up deliberately, and the interface says so where they do it.
 */
/**
 * A row's cosmetic name.
 *
 * The ladder is spread evenly across however many rows there are, always
 * keeping its lightest and its heaviest. Taking the first `count` names instead
 * left the top band called "Medium-Heavy" whenever a reader asked for four,
 * which reads as a missing row rather than a coarser cut.
 */
export function rowName(index, count, names) {
  if (count > names.length) return `Tier ${index + 1}`;
  if (count === names.length) return names[index];
  const ladder = names.slice(0, -1);   // the top name is for the full ladder
  if (count === 1) return ladder[0];
  return ladder[Math.round((index * (ladder.length - 1)) / (count - 1))];
}

export function buildWeightRows(weights, count, names = [], edges = null) {
  const cuts = edges?.length ? [...edges].sort((a, b) => a - b) : weightRowEdges(weights, count);
  let min = Infinity, max = -Infinity;
  for (const w of weights) { if (w < min) min = w; if (w > max) max = w; }
  const los = [min, ...cuts];
  const his = [...cuts, max];
  const round2 = (v) => Math.round(v * 100) / 100;
  return los.map((lo, i) => ({
    index: i, lo: round2(lo), hi: round2(his[i]), name: rowName(i, count, names),
  }));
}

/**
 * Column membership: each column takes its strongest count, not the sum.
 *
 * Summing would make wide columns look better merely for being wide. The
 * peak-relative scaling is already in `playerFit`, so nothing is renormalised
 * here — only the floor is applied.
 */
function columnMemberships(ix, game, columns, policy) {
  const out = [];
  const from = ix.playerFit.start[game], to = ix.playerFit.start[game + 1];
  for (let c = 0; c < columns.length; c++) {
    const { lo, hi } = columns[c];
    let best = 0;
    for (let k = from; k < to; k++) {
      const count = ix.playerFit.idx[k];
      if (count < lo) continue;
      if (hi !== null && hi !== undefined && count > hi) continue;
      if (ix.playerFit.val[k] > best) best = ix.playerFit.val[k];
    }
    if (best >= policy.columnFloor) out.push([c, best]);
  }
  return out;
}

/**
 * Row membership: full inside a row, tapering to zero across `weightTaper`
 * units past each edge, so a game at 2.87 partly belongs to a row starting at
 * 2.90. The edges are quantile cuts rather than real boundaries, and BGG
 * publishes only a mean weight, so a hard cut asserts a precision the data
 * does not have.
 */
function rowMemberships(weight, rows, policy) {
  const taper = policy.weightTaper;
  const out = [];
  for (const row of rows) {
    if (weight >= row.lo && weight <= row.hi) out.push([row.index, 1.0]);
    else if (weight < row.lo && row.lo - weight < taper)
      out.push([row.index, 1.0 - (row.lo - weight) / taper]);
    else if (weight > row.hi && weight - row.hi < taper)
      out.push([row.index, 1.0 - (weight - row.hi) / taper]);
  }
  return out;
}

/** An axis: a game row in, `[bucket, membership]` pairs out. */
export function playerAxis(columns) {
  return {
    key: (i) => columns[i].label,
    of: (ix, g, policy) => columnMemberships(ix, g, columns, policy),
  };
}

export function weightAxis(rows) {
  return {
    key: (i) => String(i),
    of: (ix, g, policy) => rowMemberships(ix.weight[g], rows, policy),
  };
}

/**
 * Cross the axes into cells and place every game in each by degree.
 *
 * The axis list may be empty, and that is the important case: with no axes
 * there is one cell holding the whole corpus at degree 1, which *is* the
 * collection. `pipeline/collection.py` says the same thing on the Python side —
 * "the grid with no axes: one cell holding the whole game space" — so the grid
 * is a form of the collection rather than a different object. One axis gives
 * columns; two gives the grid.
 *
 * Returns pools as flat arrays of game rows plus their membership, which is the
 * shape the scorer wants. Cells below `cellFloor` are dropped — quietly the
 * most performance-relevant constant there is, since it keeps a pool in the
 * hundreds rather than at the size of the corpus.
 */
export function buildCells(ix, { columns, rows, axes = null, include = null }) {
  const policy = ix.policy;
  const list = axes ?? [
    ...(columns ? [playerAxis(columns)] : []),
    ...(rows ? [weightAxis(rows)] : []),
  ];
  const cells = new Map();

  for (let g = 0; g < ix.n; g++) {
    if (include && !include[g]) continue;
    let combos = [{ parts: [], degree: 1 }];
    for (const axis of list) {
      const next = [];
      for (const combo of combos) {
        for (const [i, m] of axis.of(ix, g, policy)) {
          next.push({ parts: [...combo.parts, axis.key(i)], degree: combo.degree * m });
        }
      }
      combos = next;
      if (!combos.length) break;
    }
    for (const combo of combos) {
      if (combo.degree <= policy.cellFloor) continue;
      const key = combo.parts.join('|');
      let cell = cells.get(key);
      if (!cell) {
        cell = {
          key, labels: combo.parts, games: [], degree: [],
          column: combo.parts[0], row: combo.parts[1] === undefined
            ? undefined : Number(combo.parts[1]),
        };
        cells.set(key, cell);
      }
      cell.games.push(g);
      cell.degree.push(combo.degree);
    }
  }

  for (const cell of cells.values()) {
    cell.games = Int32Array.from(cell.games);
    cell.degree = Float64Array.from(cell.degree);
  }
  // Deterministic: contests must not hinge on iteration order.
  return [...cells.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
