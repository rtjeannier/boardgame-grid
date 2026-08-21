/**
 * Engine output in the shape the views already read.
 *
 * The grid, drawer, radar and scatter were all written against `grid.json`, and
 * none of them needs to know that a live engine now produces it. Keeping the
 * shape means the rendering work stays about rendering — and it keeps a useful
 * property besides: the same views can display a precomputed grid or a
 * recomputed one, so first paint and first interaction cannot look different.
 */

/** Per group, the quality-scaled loading a game contributes *in this cell*. */
function spokeCoverage(ix, cell, poolIndex, nGroups) {
  const out = new Array(nGroups).fill(0);
  for (let k = cell.w.start[poolIndex]; k < cell.w.start[poolIndex + 1]; k++) {
    out[ix.groupOf[cell.w.axis[k]]] += cell.w.val[k];
  }
  return out.map((v) => Math.round(v * 1000) / 1000);
}

/** A game's strongest groups, for the legend and the drawer. */
function topGroups(ix, game, names, limit = 3, floor = 0.05) {
  const totals = new Array(names.length).fill(0);
  for (let k = ix.embedding.start[game]; k < ix.embedding.start[game + 1]; k++) {
    totals[ix.groupOf[ix.embedding.idx[k]]] += ix.embedding.val[k];
  }
  return totals
    .map((value, i) => ({ name: names[i], value: Math.round(value * 100) / 100 }))
    .filter((g) => g.value > floor)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/**
 * The player counts a game is at its best at.
 *
 * `playerFit` is peak-relative, so the counts scoring at or near 1.0 are the
 * ones the community likes most — which is what the drawer means by "best".
 */
function bestCounts(ix, game) {
  const out = [];
  for (let k = ix.playerFit.start[game]; k < ix.playerFit.start[game + 1]; k++) {
    if (ix.playerFit.val[k] >= 0.9) out.push(ix.playerFit.idx[k]);
  }
  return out.length ? out.sort((a, b) => a - b) : [];
}

export function toGridData(ix, results, cells, rows, columns, extra = {}) {
  const names = ix.groups.map((g) => g.name);
  const byKey = new Map(cells.map((c) => [c.key, c]));

  const gameJson = (cell, poolIndex) => {
    const g = cell.games[poolIndex];
    const groups = topGroups(ix, g, names);
    return {
      id: ix.ids[g], name: ix.names[g], year: ix.year[g], rank: ix.rank[g],
      rating: ix.rating[g], usersRated: ix.usersRated[g],
      weight: ix.weight[g], playtime: ix.playtime[g],
      best_counts: bestCounts(ix, g),
      url: `https://boardgamegeek.com/boardgame/${ix.ids[g]}`,
      x: ix.xy ? ix.xy[g * 2] : 0, y: ix.xy ? ix.xy[g * 2 + 1] : 0,
      genre: groups.length ? groups[0].name : null,
      genres: groups,
      coverage: spokeCoverage(ix, cell, poolIndex, names.length),
    };
  };

  return {
    meta: {
      playerColumns: columns.map((c) => c.label),
      weightRows: rows,
      genreDimensions: names,
      gameCount: ix.n,
      source: ix.model?.corpus ?? 'contract',
      generatedAt: ix.model?.builtAt ?? '',
      ...extra,
    },
    cells: results.map((r) => {
      const cell = byKey.get(r.key);
      const at = (game) => cell.games.indexOf(game);
      return {
        column: r.column, row: r.row, candidateCount: r.candidateCount,
        assignments: r.picks.map((game, i) => ({
          game: gameJson(cell, at(game)),
          gain: r.gains[i] === null ? null : Math.round(r.gains[i] * 1000) / 1000,
        })),
        alternates: r.alternates.map((game) => gameJson(cell, at(game))),
      };
    }),
  };
}
