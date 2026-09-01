/**
 * What a game is worth to a cell right now.
 *
 * Picture a radar chart with one spoke per genre. Each game covers every axis
 * with "probability" membership x quality x loading, and a set covers an axis
 * unless all of them miss it. A candidate is worth whatever it adds to the part
 * still uncovered — so a near-duplicate of something already there is worth
 * very little, however well-rated it is.
 *
 * Two caches carry over from the Python, and they are not optimisations of the
 * inner loop so much as of the algorithm. Without them this is O(pool x shelf x
 * simDims) per cell per round — about 22 billion multiply-adds over a full
 * allocation, which no amount of typed-array care would rescue.
 *
 *   - the shelf keeps one similarity *column* per game placed anywhere, since
 *     the shelf only grows between resets;
 *   - each cell keeps a running maximum of how close its candidates are to
 *     anything it already holds, fed by the very column the shelf just built.
 */

/** Similarity of every game to `game`, scattered through the inverted index. */
function similarityColumn(ix, game, out) {
  out.fill(0);
  const { sim, postings } = ix;
  for (let k = sim.start[game]; k < sim.start[game + 1]; k++) {
    const dim = sim.idx[k], v = sim.val[k];
    for (let p = postings.start[dim]; p < postings.start[dim + 1]; p++) {
      out[postings.game[p]] += v * postings.val[p];
    }
  }
  return out;
}

/** The genre family a game is most of — the kind it counts as for one-per-cell. */
function primaryGroups(ix) {
  const nGroups = ix.groups.length;
  const out = new Int32Array(ix.n);
  const totals = new Float64Array(nGroups);
  for (let g = 0; g < ix.n; g++) {
    totals.fill(0);
    for (let k = ix.embedding.start[g]; k < ix.embedding.start[g + 1]; k++) {
      totals[ix.groupOf[ix.embedding.idx[k]]] += ix.embedding.val[k];
    }
    let best = 0, at = 0;
    for (let s = 0; s < nGroups; s++) if (totals[s] > best) { best = totals[s]; at = s; }
    out[g] = at;
  }
  return out;
}

export class CoverageScorer {
  /**
   * @param ix       indexed contract
   * @param weights  `loading x quality` per embedding entry (see quality.js)
   * @param genreWeights  per group, how much space that spoke offers. A reader
   *   who discounts a genre gets a *shorter spoke*, never scaled loadings:
   *   scaling loadings makes the axis fill more slowly, so it stays the
   *   emptiest region of the chart and the allocator chases it — the opposite
   *   of what was asked. It would also shift peak-relative genre membership and
   *   silently corrupt every genre's rating span.
   */
  constructor(ix, weights, cells, { genreWeights = null } = {}) {
    this.ix = ix;
    this.policy = ix.policy;
    this.cells = cells;
    this.primary = primaryGroups(ix);

    // Per-axis space to fill. Two things multiplied: what the axis is worth,
    // which every reader shares, and the reader's own per-genre weight on top.
    //
    // The first is the model's, not a knob: every spoke carries an equal share
    // and its axes divide that share by reach, so a family does not get more
    // say for having been cut into more pieces by the clustering. Counting each
    // axis as 1 gave Area Majority (15 axes) five times the vote of Tile
    // Placement (3). See `coverage.axis_weights` in the pipeline, which
    // computes these and publishes them per dimension.
    this.axisRoom = Float64Array.from(ix.axisWeight);
    if (genreWeights) {
      for (let a = 0; a < ix.nAxes; a++) {
        const w = genreWeights[ix.groupOf[a]];
        if (w !== undefined) this.axisRoom[a] *= w;
      }
    }

    // Per cell: the candidates' weight vectors, flattened.
    for (const cell of cells) {
      const nPool = cell.games.length;
      const starts = new Int32Array(nPool + 1);
      for (let i = 0; i < nPool; i++) {
        const g = cell.games[i];
        starts[i + 1] = starts[i] + (ix.embedding.start[g + 1] - ix.embedding.start[g]);
      }
      const axis = new Int32Array(starts[nPool]);
      const val = new Float64Array(starts[nPool]);
      let at = 0;
      for (let i = 0; i < nPool; i++) {
        const g = cell.games[i];
        for (let k = ix.embedding.start[g]; k < ix.embedding.start[g + 1]; k++) {
          axis[at] = ix.embedding.idx[k];
          val[at] = weights[k] * cell.degree[i];
          at++;
        }
      }
      cell.w = { start: starts, axis, val };
      cell.uncovered = Float64Array.from(this.axisRoom);
      cell.chosen = [];
      cell.kinds = new Set();
      cell.closest = new Float64Array(nPool);
      cell.scores = new Float64Array(nPool);
      cell.primary = Int32Array.from(cell.games, (g) => this.primary[g]);
    }

    this.shelved = [];
    this.shelfCols = [];
    this.scratch = new Float64Array(ix.n);
    this._reach = null;
  }

  /** Every candidate in one cell, scored together. */
  scoreAll(cell) {
    const { start, axis, val } = cell.w;
    const nPool = cell.games.length;
    const out = cell.scores;
    const { similarityExponent: simExp, collectionWeight: collW,
            repeatPenalty: repeat } = this.policy;

    for (let i = 0; i < nPool; i++) {
      let raw = 0;
      for (let k = start[i]; k < start[i + 1]; k++) raw += val[k] * cell.uncovered[axis[k]];

      if (cell.chosen.length) {
        const c = cell.closest[i];
        raw *= 1 - (c < 0 ? 0 : c > 1 ? 1 : c) ** simExp;
      }
      if (cell.kinds.size && cell.kinds.has(cell.primary[i])) raw *= repeat;
      out[i] = raw;
    }

    if (collW && this.shelfCols.length) {
      for (let i = 0; i < nPool; i++) {
        const g = cell.games[i];
        let closest = 0;
        for (const col of this.shelfCols) {
          // A game is not a duplicate of itself: repair rescores placed games.
          if (col.game === g) continue;
          if (col.values[g] > closest) closest = col.values[g];
        }
        let fresh = 1 - (closest < 0 ? 0 : closest > 1 ? 1 : closest) ** simExp;
        const redone = this._redone(g);
        if (redone !== null) fresh = Math.min(fresh, 1 - redone ** simExp);
        out[i] *= (fresh < 0 ? 0 : fresh) ** collW;
      }
    }
    return out;
  }

  /**
   * How much of this game the shelf already holds as a *redoing* of it.
   *
   * Tag similarity misses this: `7 Wonders Duel` and `Duel for Middle-earth`
   * score 0.583, barely above two unrelated games, because each carries tags
   * the other lacks. BGG states plainly that one reimplements the other. But a
   * lineage is only redundant if it stayed put, so it is weighted by how much
   * the two games' cell reach overlaps.
   */
  _redone(game) {
    const kin = this.ix.kin.get(game);
    if (!kin) return null;
    let worst = 0, found = false;
    for (const other of kin) {
      if (!this.shelved.includes(other) || other === game) continue;
      found = true;
      const o = this._overlap(game, other);
      if (o > worst) worst = o;
    }
    return found ? worst : null;
  }

  /** Cosine between two games' cell-membership vectors. */
  _overlap(a, b) {
    if (!this._reach) {
      this._reach = new Map();
      for (const cell of this.cells) {
        for (let i = 0; i < cell.games.length; i++) {
          const g = cell.games[i];
          let m = this._reach.get(g);
          if (!m) { m = new Map(); this._reach.set(g, m); }
          m.set(cell.key, cell.degree[i]);
        }
      }
    }
    const here = this._reach.get(a), there = this._reach.get(b);
    if (!here || !there) return 0;
    let dot = 0, na = 0, nb = 0;
    for (const v of here.values()) na += v * v;
    for (const [k, v] of there) { nb += v * v; const h = here.get(k); if (h) dot += h * v; }
    const scale = Math.sqrt(na) * Math.sqrt(nb);
    if (!scale) return 0;
    const c = dot / scale;
    return c < 0 ? 0 : c > 1 ? 1 : c;
  }

  take(cell, i) {
    const g = cell.games[i];
    for (let k = cell.w.start[i]; k < cell.w.start[i + 1]; k++) {
      cell.uncovered[cell.w.axis[k]] *= 1 - cell.w.val[k];
    }
    cell.chosen.push(i);
    cell.kinds.add(cell.primary[i]);
    this.shelved.push(g);

    const values = new Float64Array(this.ix.n);
    similarityColumn(this.ix, g, values);
    this.shelfCols.push({ game: g, values });
    // The same column answers "how close is each candidate to anything this
    // cell holds", so the per-cell maximum comes free.
    for (let j = 0; j < cell.games.length; j++) {
      const v = values[cell.games[j]];
      if (v > cell.closest[j]) cell.closest[j] = v;
    }
  }

  resetCell(cell) {
    for (const i of cell.chosen) {
      const at = this.shelved.indexOf(cell.games[i]);
      if (at >= 0) this.shelved.splice(at, 1);
    }
    cell.chosen = [];
    cell.kinds = new Set();
    cell.closest.fill(0);
    cell.uncovered.set(this.axisRoom);
    // Drop the columns of games no longer shelved. Compacting rather than
    // rebuilding: a column is one game's similarity to the whole corpus and
    // does not change when *other* games leave.
    const remaining = [...this.shelved];
    this.shelfCols = this.shelfCols.filter((col) => {
      const at = remaining.indexOf(col.game);
      if (at < 0) return false;
      remaining.splice(at, 1);
      return true;
    });
  }
}
