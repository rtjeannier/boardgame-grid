/**
 * One shape for a game, whatever is drawing it.
 *
 * The interface this replaces fed its game components seven different shapes —
 * a contract record, a `grid.json` entry, an allocation result, a shelf audit
 * row, a search hit, an alternate, and in one place a raw typed-array index.
 * Four of them spelled the rank differently and two had no rank at all. Every
 * view now goes through here, so a game reads the same wherever it appears.
 */

/** Player counts a game is at its best at, as a range when they are contiguous. */
export function bestAt(ix, row) {
  const counts = [];
  for (let k = ix.playerFit.start[row]; k < ix.playerFit.start[row + 1]; k++) {
    if (ix.playerFit.val[k] >= 0.999) counts.push(ix.playerFit.idx[k]);
  }
  if (!counts.length) return null;
  counts.sort((a, b) => a - b);
  const contiguous = counts[counts.length - 1] - counts[0] === counts.length - 1;
  return contiguous && counts.length > 1
    ? `${counts[0]}–${counts[counts.length - 1]}`
    : counts.join(', ');
}

/**
 * The first part of a compound name.
 *
 * An axis is named after several tags at once — "Paper-and-Pencil · Bingo ·
 * Simultaneous Action Selection" — because that is what the cluster is. As a
 * label it is unreadable and, in a bar chart, it squeezes the bar to nothing.
 */
const lead = (name) => (name ?? '').split(' · ')[0];

/** A game's strongest axes, named. Descriptive only: nothing groups by them. */
export function axesOf(ix, row, { limit = 3, floor = 0.05 } = {}) {
  const out = [];
  for (let k = ix.embedding.start[row]; k < ix.embedding.start[row + 1]; k++) {
    out.push({
      label: lead(ix.axisNames[ix.embedding.idx[k]]),
      full: ix.axisNames[ix.embedding.idx[k]],
      value: ix.embedding.val[k],
    });
  }
  return out
    .filter((a) => a.value > floor)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

const minutes = (m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${m}m`);

export function toGameView(ix, row, {
  shelf = null, place = null,
  pinned = false, blocked = false,
  owned = false, reason = null, axes = null,
} = {}) {
  return {
    row,
    id: ix.ids[row],
    name: ix.names[row],
    rank: ix.rank[row],
    rankLabel: `#${ix.rank[row].toLocaleString()}`,
    // A game's id *is* its BoardGameGeek id — the CSV import is keyed on
    // `objectid` and the contract carries it through — so the link needs no
    // lookup. Spelled here and nowhere else; `engine/present.js` builds the
    // same string for the exported grid.
    bgg: `https://boardgamegeek.com/boardgame/${ix.ids[row]}`,
    year: ix.year[row],
    rating: ix.rating[row],
    weight: Math.round(ix.weight[row] * 10) / 10,
    playtime: ix.playtime[row],
    timeLabel: minutes(ix.playtime[row]),
    players: bestAt(ix, row),
    axes: axes ?? axesOf(ix, row),
    tags: (axes ?? axesOf(ix, row)).map((a) => a.label.toLowerCase()).join(' · '),
    shelf, place, reason,
    pinned, blocked, owned,
  };
}
