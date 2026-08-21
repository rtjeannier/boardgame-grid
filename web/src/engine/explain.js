/**
 * Why a game the reader owns did not make the shelf.
 *
 * The bare fact is thin — it is not in the final set — and stating it as
 * "something else won every cell it reaches" claims a mechanism nothing
 * checked. The contract carries enough to say what actually happened, so this
 * says that instead, and admits when it does not know.
 */

/** Cosine between two games, over the contract's opaque similarity space. */
export function similarityBetween(ix, a, b) {
  const { sim } = ix;
  let i = sim.start[a], j = sim.start[b], dot = 0;
  const endA = sim.start[a + 1], endB = sim.start[b + 1];
  while (i < endA && j < endB) {
    const da = sim.idx[i], db = sim.idx[j];
    if (da === db) { dot += sim.val[i] * sim.val[j]; i++; j++; }
    else if (da < db) i++;
    else j++;
  }
  return dot;
}

/** Cells the game reaches at all, strongest membership first. */
function reach(cells, game) {
  const out = [];
  for (const cell of cells) {
    const at = cell.games.indexOf(game);
    if (at >= 0) out.push({ cell, degree: cell.degree[at] });
  }
  return out.sort((a, b) => b.degree - a.degree);
}

/** A near-duplicate is worth naming; a merely similar game is not. */
const CLOSE = 0.5;

/**
 * What a similarity score actually means, in words.
 *
 * A cosine is not a percentage of sameness: two unrelated games in this corpus
 * average 0.125, so zero is not the floor and 0.5 is not "half the same game".
 * The contract ships the percentiles precisely so this can be said properly.
 */
export function howAlike(scale, value) {
  if (!scale) return `similarity ${value.toFixed(2)}`;
  if (value >= scale.p99) return 'closer than 99% of all pairs of games';
  if (value >= scale.p95) return 'closer than 95% of all pairs of games';
  if (value >= scale.p90) return 'closer than 90% of all pairs of games';
  return 'more alike than most';
}

export function explainCut(ix, game, shelved, cells, picksByCell) {
  // 1. The model says outright that another shelved game is a fuller record of
  //    this one — every tag this carries is already on that, in the same family.
  const thin = ix.thin.get(game);
  if (thin) {
    const by = [...thin].filter((g) => shelved.has(g));
    if (by.length) {
      return { kind: 'superseded', by: by.map((g) => ix.names[g]) };
    }
  }

  // 2. BGG says one game reimplements the other.
  const kin = ix.kin.get(game);
  if (kin) {
    const by = kin.filter((g) => shelved.has(g));
    if (by.length) return { kind: 'reimplemented', by: by.map((g) => ix.names[g]) };
  }

  const homes = reach(cells, game);
  if (!homes.length) {
    // No cell at all: the community rejects every count it might sit at, or its
    // weight falls outside every row.
    return { kind: 'unplaceable' };
  }

  // 3. A near-copy of it already holds a slot in a cell it reaches.
  let closest = null;
  for (const { cell } of homes) {
    for (const other of picksByCell.get(cell.key) ?? []) {
      if (other === game) continue;
      const s = similarityBetween(ix, game, other);
      if (!closest || s > closest.similarity) {
        closest = { similarity: s, name: ix.names[other], cell: cell.key };
      }
    }
  }
  if (closest && closest.similarity >= CLOSE) {
    return { kind: 'crowded', by: [closest.name], cell: closest.cell,
             similarity: closest.similarity, scale: ix.similarityScale };
  }

  // 4. Nothing that specific — it simply lost its cells to better-rated games.
  const home = homes[0];
  const rivals = (picksByCell.get(home.cell.key) ?? []).map((g) => ix.names[g]);
  return {
    kind: 'outranked',
    cell: home.cell.key,
    column: home.cell.column,
    reaches: homes.length,
    by: rivals.slice(0, 3),
    better: rivals.length > 0 && ix.rank[game] > Math.min(
      ...(picksByCell.get(home.cell.key) ?? []).map((g) => ix.rank[g])),
  };
}

/** One line a reader can act on, per cut game. `labelFor` names a cell. */
export function cutSentence(reason, labelFor = (key) => key) {
  const list = (names) => names.join(' and ');
  const cell = reason.cell ? labelFor(reason.cell) : '';
  switch (reason.kind) {
    case 'superseded':
      return `${list(reason.by)} carries everything this does — same game, fuller record.`;
    case 'reimplemented':
      return `BGG calls this the same design as ${list(reason.by)}, which took the slot.`;
    case 'crowded':
      // Named as the closest game *already shelved in a cell this one reaches*,
      // not as its nearest neighbour in the corpus — those are different
      // claims, and only the first is the reason it lost a slot.
      return `${howAlike(reason.scale, reason.similarity)} to ${list(reason.by)}, `
        + `which already holds a slot in ${cell}.`;
    case 'unplaceable':
      return 'Reaches no cell — the community endorses no player count for it.';
    case 'outranked':
      return `Lost ${cell} to ${list(reason.by)}`
        + (reason.reaches > 1 ? `, and ${reason.reaches - 1} other cell${reason.reaches > 2 ? 's' : ''} likewise.` : '.');
    default:
      return 'Not shelved.';
  }
}
