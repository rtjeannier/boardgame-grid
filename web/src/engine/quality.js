/**
 * Quality, derived rather than shipped.
 *
 * A game's coverage of a genre is quality x loading, and quality asks "how good
 * is this, *for this kind of game*". Judged against the whole population a
 * genre whose best game is merely very good could never be covered: Crokinole
 * is the finest dexterity game there is and rates 7.80 where the population
 * tops out at 8.39, so it scored 0.68 and the dexterity axis sat two thirds
 * empty however many dexterity games you owned.
 *
 * The contract ships each genre's own rating span instead of a resolved
 * quality, which is smaller and — more importantly — keeps the reference
 * population live. Filter the corpus and the spans move; a precomputed quality
 * would quietly answer a question about games no longer on screen.
 */

/**
 * Per genre, the rating span of the games belonging to it.
 *
 * Only needed when the reader filters the corpus — otherwise the contract's own
 * `ratingLo`/`ratingHi` already say this for the full population.
 */
export function ratingSpans(ix, include) {
  const { nAxes, n, embedding, rating, policy } = ix;
  const lo = new Float64Array(nAxes).fill(Infinity);
  const hi = new Float64Array(nAxes).fill(-Infinity);

  for (let g = 0; g < n; g++) {
    if (include && !include[g]) continue;
    const from = embedding.start[g], to = embedding.start[g + 1];
    let peak = 0;
    for (let k = from; k < to; k++) if (embedding.val[k] > peak) peak = embedding.val[k];
    const bar = policy.genreFloor * peak;
    for (let k = from; k < to; k++) {
      if (embedding.val[k] < bar) continue;      // peak-relative membership
      const axis = embedding.idx[k];
      if (rating[g] < lo[axis]) lo[axis] = rating[g];
      if (rating[g] > hi[axis]) hi[axis] = rating[g];
    }
  }
  for (let a = 0; a < nAxes; a++) {
    if (!Number.isFinite(lo[a])) { lo[a] = 0; hi[a] = 1; }
  }
  return { lo, hi };
}

/**
 * `loading x quality` per embedding entry — the vector selection actually
 * scores, before cell membership scales it.
 *
 * Aligned with `embedding.val`, so the two are read together in the inner loop.
 */
export function coverageWeights(ix, spans = null) {
  const { embedding, rating, policy } = ix;
  const lo = spans ? spans.lo : ix.ratingLo;
  const hi = spans ? spans.hi : ix.ratingHi;
  const { qualityFloor: floor, qualityExponent: exponent } = policy;

  const out = new Float64Array(embedding.val.length);
  for (let g = 0; g < ix.n; g++) {
    for (let k = embedding.start[g]; k < embedding.start[g + 1]; k++) {
      const axis = embedding.idx[k];
      const span = Math.max(hi[axis] - lo[axis], 1e-9);
      let norm = (rating[g] - lo[axis]) / span;
      norm = norm < 0 ? 0 : norm > 1 ? 1 : norm;
      out[k] = embedding.val[k] * (floor + (1 - floor) * norm ** exponent);
    }
  }
  return out;
}
