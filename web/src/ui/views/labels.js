import { rowsOfPicks, shelvedRows } from '../shelved.js';

/**
 * A cell key as a person would say it: "4 players · Medium".
 *
 * Which axis a lone part names is not readable from the key — with one axis on
 * a cell key is a bare string, a column label under `players` and a row index
 * under `weight`, and "3" is a valid both ways. This used to try `rowName`
 * first, so every column of a player-count-only grid was labelled with a weight
 * band: the 3-players column read "Medium-Heavy". Only `built.axes` knows, so
 * only `built.axes` decides.
 */
export function cellLabeller(built) {
  const rowName = new Map(built.rows.map((r) => [String(r.index), r.name]));
  const axes = built.axes ?? [];
  const players = (label) => (label === '1' ? 'solo'
    : `${label} player${label === '1' ? '' : 's'}`);
  const band = (index) => rowName.get(index) ?? index;
  return (key) => {
    if (!key) return 'the collection';
    const parts = key.split('|');
    if (parts.length === 1) {
      return axes.includes('weight') && !axes.includes('players')
        ? band(parts[0]) : players(parts[0]);
    }
    return `${players(parts[0])} · ${band(parts[1])}`;
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
  const shelved = new Set(shelvedRows(ix, grid));
  const picksByCell = new Map(
    grid.map((c) => [c.key, rowsOfPicks(ix, c.picks)]));

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
