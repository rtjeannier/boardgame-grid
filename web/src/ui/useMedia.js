/**
 * A media query, as state.
 *
 * The grid reflows rather than shrinking, and reflowing means a different shape
 * of markup — a matrix of cells becomes a list of shelves. CSS alone cannot do
 * that here: the board interleaves row headers with cells, so turning it into a
 * list would mean rendering both and hiding one, and the style guide's line is
 * *"do not conceal page overflow"*. So the layout is chosen in JS and only one
 * of them is ever built.
 *
 * Server-safe: there is no window when this renders on the server, and the wide
 * layout is the one to assume — a narrow reader gets the right shape on the
 * first client paint, and no reader gets a layout that never corrects.
 */

import { useEffect, useState } from 'react';

export default function useMedia(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    // `addListener` is the old spelling and is what jsdom's older shim exposes.
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener?.(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener?.(on);
    };
  }, [query]);

  return matches;
}

/**
 * Where the board stops being a board.
 *
 * Measured on the shipped seven-column grid, the room a game's name gets:
 * 1440px 17 characters, 1280px 13, 1024px 7, 900px 4, and at 768px and below
 * the board is narrower than its own fixed chrome — the row heads and the add
 * strip — so the columns resolve to zero or negative width. Dropping the 300px
 * analysis rail rescues everything down to about 900px, where a name still gets
 * twelve characters and a title you know is recognisable. Below that it falls
 * away fast — nine characters at 768px, five at 600 — so the matrix reflows into
 * a list rather than truncating, which the guide rejects outright.
 */
// The rail's own reflow at 1199px is a media query in `Collection.module.css`,
// where it needs no JavaScript: only the matrix-to-list change does, because
// that one is a different shape of markup rather than a different layout.
export const STACKED = '(max-width: 899px)';
