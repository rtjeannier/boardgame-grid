/**
 * Everything the interface can change, and the collection that comes out of it.
 *
 * One object, one recompute. `axes` is what makes it a collection or a grid: an
 * empty list is a single cell holding the whole corpus, one axis gives columns,
 * two gives shelves. Nothing else in here knows the difference.
 */

import { useCallback, useMemo, useReducer } from 'react';
import { buildGrid, coverageOf, spokeVector } from '../engine/index.js';

export const AXES = [
  { key: 'players', label: 'player count' },
  { key: 'weight', label: 'weight' },
];

const EMPTY = [];

const initial = {
  // Nothing on: the collection is one shelf holding the whole space. Splitting
  // is something a reader chooses, not the state the app starts in.
  axes: [],
  owned: EMPTY, pinned: EMPTY, blocked: EMPTY,
  depthOverrides: {},
  rowCount: 5,
  open: null,          // the game whose drawer is showing
};

function toggle(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function reduce(state, action) {
  switch (action.type) {
    case 'axis':
      return { ...state, axes: toggle(state.axes, action.key), depthOverrides: {} };
    case 'own':
      return { ...state, owned: toggle(state.owned, action.id) };
    case 'ownMany':
      return { ...state, owned: [...new Set([...state.owned, ...action.ids])] };
    // Pinning something you do not own is still meaningful: it says "whatever
    // else changes, keep this in". Blocking beats pinning, because "I want rid
    // of this" is the stronger statement.
    case 'pin':
      return { ...state, pinned: toggle(state.pinned, action.id),
               blocked: state.blocked.filter((x) => x !== action.id) };
    case 'block':
      return { ...state, blocked: toggle(state.blocked, action.id),
               pinned: state.pinned.filter((x) => x !== action.id) };
    case 'depth': {
      const next = { ...state.depthOverrides };
      if (action.value == null) delete next[action.key];
      else next[action.key] = action.value;
      return { ...state, depthOverrides: next };
    }
    case 'rows':
      return { ...state, rowCount: action.value, depthOverrides: {} };
    case 'open':
      return { ...state, open: action.game };
    case 'reset':
      return { ...initial };
    default:
      return state;
  }
}

/** Each game's share of what its shelf covers — what would be lost without it. */
export function sharesOf(ix, weights, rows) {
  const n = ix.groups.length;
  const vectors = rows.map((r) => spokeVector(ix, weights, r, n));
  const sum = (v) => v.reduce((a, b) => a + b, 0);
  const total = sum(coverageOf(vectors, n));
  if (!(total > 0)) return rows.map(() => 0);
  return rows.map((_, i) => {
    const without = sum(coverageOf(vectors.filter((_, j) => j !== i), n));
    return (total - without) / total;
  });
}

export function useCollection(contract) {
  const [state, dispatch] = useReducer(reduce, initial);

  const built = useMemo(() => buildGrid(contract, {
    axes: state.axes,
    rowCount: state.rowCount,
    owned: state.owned,
    keepers: state.pinned,
    banned: state.blocked,
    depthOverrides: state.depthOverrides,
    alternatesLimit: 6,
  }), [contract, state.axes, state.rowCount, state.owned, state.pinned,
       state.blocked, state.depthOverrides]);

  const actions = useMemo(() => ({
    toggleAxis: (key) => dispatch({ type: 'axis', key }),
    own: (id) => dispatch({ type: 'own', id }),
    ownMany: (ids) => dispatch({ type: 'ownMany', ids }),
    pin: (id) => dispatch({ type: 'pin', id }),
    block: (id) => dispatch({ type: 'block', id }),
    setDepth: (key, value) => dispatch({ type: 'depth', key, value }),
    setRows: (value) => dispatch({ type: 'rows', value }),
    open: (game) => dispatch({ type: 'open', game }),
    reset: () => dispatch({ type: 'reset' }),
  }), []);

  const has = useCallback((list, id) => list.includes(id), []);
  return { state, built, actions, has };
}
