/**
 * Turn the contract into flat typed arrays.
 *
 * The engine re-runs selection on every change a reader makes, so the layout
 * matters as much as the algorithm: objects and Maps in the inner loop cost
 * roughly ten times what indexed Float64Arrays do, which is the difference
 * between a slider that responds and one that stutters.
 *
 * Everything sparse is stored CSR-style — a `start` array of offsets into flat
 * index and value arrays — because a game touches ~7 of 77 genre axes and ~9 of
 * 978 similarity dimensions. Densifying either would be a hundredfold waste.
 */

/** Flatten `[[i, v], ...]` per row into CSR arrays. */
function csr(rows, length) {
  const start = new Int32Array(length + 1);
  for (let i = 0; i < length; i++) start[i + 1] = start[i] + rows[i].length;
  const total = start[length];
  const idx = new Int32Array(total);
  const val = new Float64Array(total);
  let k = 0;
  for (let i = 0; i < length; i++) {
    for (const [j, v] of rows[i]) { idx[k] = j; val[k] = v; k++; }
  }
  return { start, idx, val };
}

/**
 * An inverted index over the similarity space: dimension -> the games carrying
 * it. Similarity to one game is then a scatter over that game's own
 * dimensions — about 390 multiply-adds against 5,000 sparse dot products, and
 * it is what makes the duplicate-suppression term affordable at all.
 */
function invert(sim, nGames, nDims) {
  const counts = new Int32Array(nDims);
  for (let k = 0; k < sim.idx.length; k++) counts[sim.idx[k]]++;
  const start = new Int32Array(nDims + 1);
  for (let d = 0; d < nDims; d++) start[d + 1] = start[d] + counts[d];
  const cursor = start.slice(0, nDims);
  const game = new Int32Array(sim.idx.length);
  const val = new Float64Array(sim.idx.length);
  for (let g = 0; g < nGames; g++) {
    for (let k = sim.start[g]; k < sim.start[g + 1]; k++) {
      const at = cursor[sim.idx[k]]++;
      game[at] = g;
      val[at] = sim.val[k];
    }
  }
  return { start, game, val };
}

export function indexContract(contract) {
  const games = contract.games;
  const n = games.length;

  const ids = new Int32Array(n);
  const rank = new Int32Array(n);
  const year = new Int32Array(n);
  const usersRated = new Int32Array(n);
  const playtime = new Int32Array(n);
  const rating = new Float64Array(n);
  const weight = new Float64Array(n);
  const names = new Array(n);
  const xy = new Float64Array(n * 2);
  const rowOf = new Map();

  for (let i = 0; i < n; i++) {
    const g = games[i];
    ids[i] = g.id; rank[i] = g.rank; year[i] = g.year;
    usersRated[i] = g.usersRated; playtime[i] = g.playtime;
    rating[i] = g.rating; weight[i] = g.weight; names[i] = g.name;
    xy[i * 2] = g.xy[0]; xy[i * 2 + 1] = g.xy[1];
    rowOf.set(g.id, i);
  }

  const nAxes = contract.dimensions.length;
  const simDims = 1 + contract.games.reduce(
    (m, g) => g.sim.reduce((a, [d]) => Math.max(a, d), m), 0);

  const embedding = csr(games.map((g) => g.embedding), n);
  const sim = csr(games.map((g) => g.sim), n);

  // playerFit is keyed by count, and counts are small and dense enough to store
  // as parallel arrays rather than objects.
  const fitRows = games.map((g) =>
    Object.entries(g.playerFit).map(([c, v]) => [Number(c), v]));
  const playerFit = csr(fitRows, n);

  // Relations, as rows rather than ids — the engine never wants ids.
  const asRows = (links) =>
    (links || []).map((id) => rowOf.get(id)).filter((r) => r !== undefined);
  const kin = new Map();      // BGG says one reimplements the other
  const thin = new Map();     // this game is the impoverished record of another
  for (let i = 0; i < n; i++) {
    const k = asRows(games[i].kin);
    if (k.length) kin.set(i, k);
    const t = asRows(games[i].thin);
    if (t.length) thin.set(i, new Set(t));
  }

  const groupOf = new Int32Array(nAxes);
  const ratingLo = new Float64Array(nAxes);
  const ratingHi = new Float64Array(nAxes);
  const axisNames = new Array(nAxes);
  for (const d of contract.dimensions) {
    groupOf[d.id] = d.group;
    ratingLo[d.id] = d.ratingLo;
    ratingHi[d.id] = d.ratingHi;
    axisNames[d.id] = d.name;
  }

  return {
    n, nAxes, simDims,
    ids, rowOf, names, rank, year, rating, usersRated, weight, playtime, xy,
    embedding, sim, playerFit, kin, thin,
    postings: invert(sim, n, simDims),
    groupOf, ratingLo, ratingHi, axisNames,
    groups: contract.groups,
    similarityScale: contract.similarityScale ?? null,
    policy: contract.policy,
    defaultPicks: contract.defaultPicks,
    model: contract.model,
  };
}
