/** A cell key as a person would say it: "4 players · Medium". */
export function cellLabeller(built) {
  const rowName = new Map(built.rows.map((r) => [String(r.index), r.name]));
  return (key) => {
    if (!key) return 'the collection';
    const parts = key.split('|');
    if (parts.length === 1) {
      return rowName.get(parts[0]) ?? `${parts[0]} player${parts[0] === '1' ? '' : 's'}`;
    }
    const [column, row] = parts;
    const players = column === '1' ? 'solo' : `${column} players`;
    return `${players} · ${rowName.get(row) ?? row}`;
  };
}

/**
 * Why a game you own did not hold a place, naming the shelf it lost.
 *
 * `explainCut` says which of five things happened; this says where. A similarity
 * floating free of a shelf reads as a claim about the whole corpus, which is not
 * what it means — the game lost one particular contest.
 */
export function whyCut(built, engine, row) {
  const { ix, cells, grid } = built;
  const shelved = new Set(grid.flatMap((c) => c.picks.map((p) => ix.rowOf.get(p.id))));
  const picksByCell = new Map(
    grid.map((c) => [c.key, c.picks.map((p) => ix.rowOf.get(p.id))]));

  // The shelf it reaches most strongly is the one it most nearly won.
  let home = null, degree = -1;
  for (const cell of cells) {
    const at = cell.games.indexOf(row);
    if (at >= 0 && cell.degree[at] > degree) { home = cell; degree = cell.degree[at]; }
  }
  const label = cellLabeller(built);
  if (!home) return 'Reaches no shelf — the community endorses no player count for it.';

  const rivals = picksByCell.get(home.key) ?? [];
  let closest = null, best = -1;
  for (const other of rivals) {
    const s = engine.similarityBetween(ix, row, other);
    if (s > best) { best = s; closest = other; }
  }
  const thin = [...(ix.thin.get(row) ?? [])].filter((g) => shelved.has(g));
  if (thin.length) {
    return `Lost ${label(home.key)} to ${ix.names[thin[0]]} `
      + `(${engine.similarityBetween(ix, row, thin[0]).toFixed(2)}) — the same game, `
      + 'more fully recorded.';
  }
  if (closest == null) return `Lost ${label(home.key)}.`;
  return `Lost ${label(home.key)} to ${ix.names[closest]} (${best.toFixed(2)}).`;
}
