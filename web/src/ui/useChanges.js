/**
 * Which games just arrived, and which just left.
 *
 * Not a fix for row identity — that was measured and was never broken. Blocking
 * one game on a 98-row grid keeps 96 of the 98 DOM nodes and rebuilds none of
 * them, so React was already reconciling the list correctly. What was missing is
 * that a reader could not *tell*: two rows changed somewhere among ninety-eight
 * identical ones, with nothing to say which.
 *
 * So this reports the difference between one placement and the next. A game that
 * changed cell counts as arriving where it landed and leaving where it was, so
 * the eye can follow it across.
 */

import { useEffect, useRef, useState } from 'react';

/** How long a row stays marked. Presentation, so it lives with the tokens. */
const LINGER = 900;

const quiet = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param at Map of game id -> cell key, as `collectionOf` builds it.
 * @returns {{arrived: Set, left: Map}} ids that just landed, and id -> the cell
 *   each departed game was in, so it can hold its place while it fades.
 */
export function useChanges(at) {
  const previous = useRef(null);
  const [marks, setMarks] = useState({ arrived: new Set(), left: new Map() });

  useEffect(() => {
    const was = previous.current;
    previous.current = at;
    // The first placement is not a change: everything would flash at once.
    if (!was) return undefined;

    const arrived = new Set();
    const left = new Map();
    for (const [id, key] of at) if (was.get(id) !== key) arrived.add(id);
    for (const [id, key] of was) if (at.get(id) !== key) left.set(id, key);
    if (!arrived.size && !left.size) return undefined;
    if (quiet()) { setMarks({ arrived, left: new Map() }); return undefined; }

    setMarks({ arrived, left });
    const timer = setTimeout(() => setMarks({ arrived: new Set(), left: new Map() }), LINGER);
    return () => clearTimeout(timer);
  }, [at]);

  return marks;
}
