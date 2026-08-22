/**
 * Adding and removing a group, in one place.
 *
 * The grid and the axis panel both offer it, and they must do the same thing —
 * two implementations of "one more player group" is two answers to the same
 * question. Both keep the ranges contiguous: editing a range by hand can leave
 * a gap, which is the reader's business, but a button should never make one.
 */

export const label = (lo, hi) =>
  (hi == null ? `${lo}+` : lo === hi ? `${lo}` : `${lo}-${hi}`);

/** One more group: split the widest that has room, else add one off the end. */
export function splitWidest(columns) {
  let widest = -1;
  let at = -1;
  columns.forEach((c, i) => {
    const span = c.hi == null ? Infinity : c.hi - c.lo;
    if (span > widest && span >= 1) { widest = span; at = i; }
  });
  if (at < 0) {
    const last = columns[columns.length - 1];
    const from = (last.hi ?? last.lo) + 1;
    return [...columns, { lo: from, hi: null, label: label(from, null) }];
  }
  const c = columns[at];
  const mid = c.hi == null ? c.lo : Math.floor((c.lo + c.hi) / 2);
  return [
    ...columns.slice(0, at),
    { lo: c.lo, hi: mid, label: label(c.lo, mid) },
    { lo: mid + 1, hi: c.hi, label: label(mid + 1, c.hi) },
    ...columns.slice(at + 1),
  ];
}

/** One fewer: merge the last two, so the top group stays open-ended. */
export function mergeLast(columns) {
  if (columns.length < 3) return columns;
  const a = columns[columns.length - 2];
  const b = columns[columns.length - 1];
  return [...columns.slice(0, -2), { lo: a.lo, hi: b.hi, label: label(a.lo, b.hi) }];
}

/**
 * One more weight band: a new edge at the middle of the widest.
 *
 * Not "re-cut into N+1 quantiles" — that would throw away any edge the reader
 * had moved. Splitting keeps every edge they set and adds one.
 */
export function splitWidestBand(rows) {
  let widest = -1;
  let at = 0;
  rows.forEach((r, i) => {
    if (r.hi - r.lo > widest) { widest = r.hi - r.lo; at = i; }
  });
  const edges = rows.slice(0, -1).map((r) => r.hi);
  const mid = Math.round(((rows[at].lo + rows[at].hi) / 2) * 100) / 100;
  return [...edges.slice(0, at), mid, ...edges.slice(at)].sort((a, b) => a - b);
}
