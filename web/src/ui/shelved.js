/**
 * What is on the shelves right now, and where.
 *
 * One question asked from seven places — the rail, an opened shelf, a game, the
 * notice, the board, "my games", the standfirst — and until this file it was
 * written out seven times as `grid.flatMap((c) => c.picks.map((p) => p.id))`.
 * Seven spellings of one idea is seven places to fix when a pick changes shape.
 *
 * Everything here takes `grid` rather than `built`, because the grid is what
 * these are actually about and half the callers only have the grid.
 */

/** Every id currently shelved, in grid order. */
export const shelvedNow = (grid) =>
  grid.flatMap((cell) => cell.picks.map((pick) => pick.id));

/**
 * The collection, and where each of its games currently sits.
 *
 * What a split is handed so it can deal rather than choose again. The placement
 * travels with the ids because "where does this game belong" and "where did
 * this game win" are different questions with different answers — dealing by
 * belonging alone moved 101 of 272 games. A Map, because game ids are numbers
 * and an object key would stringify them.
 */
export const collectionOf = (grid) => ({
  ids: shelvedNow(grid),
  at: new Map(grid.flatMap(
    (cell) => cell.picks.map((pick) => [pick.id, cell.key]))),
});

/** The engine rows behind some picks, skipping anything the index has lost. */
export const rowsOfPicks = (ix, picks) =>
  picks.map((pick) => ix.rowOf.get(pick.id)).filter((row) => row !== undefined);

/** The engine rows behind everything shelved. */
export const shelvedRows = (ix, grid) =>
  rowsOfPicks(ix, grid.flatMap((cell) => cell.picks));
