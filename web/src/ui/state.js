/**
 * Everything the interface can change, and the collection that comes out of it.
 *
 * One object, one recompute. `axes` is what makes it a collection or a grid: an
 * empty list is a single cell holding the whole corpus, one axis gives columns,
 * two gives shelves. Nothing else in here knows the difference.
 */

import { useCallback, useMemo, useReducer } from 'react';
import {
  DEFAULT_COLUMNS, buildGrid, coverageOf, indexContract, spokeVector,
} from '../engine/index.js';

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
  columns: DEFAULT_COLUMNS,
  rowCount: 5,
  rowEdges: null,      // null means "quantiles of the corpus", which is the point
  // Hold every game you own and fill the rest around them.
  mineOnly: false,
  // What stops the fill. Not a choice between rules — a list of them, each on
  // or off, each saying whether it limits one shelf or the whole collection.
  // Every one that is on binds and the smallest wins, the way a column's depth
  // and a row's already do. Money and shelf volume are the same list again with
  // a different cost per game, the day the data carries one.
  limits: [
    { kind: 'returns', scope: 'shelf', on: true },
    { kind: 'count', scope: 'shelf', on: false, value: 5 },
    { kind: 'count', scope: 'total', on: false, value: 60 },
    { kind: 'budget', scope: 'total', on: false, value: 400 },
    { kind: 'volume', scope: 'total', on: false, value: 60 },
  ],
  panel: null,         // which axis is being configured, if any
  open: null,          // the game whose drawer is showing
  // What the last block or pin did, so the interface can say so. Blocking a
  // game re-runs the whole selection rather than patching one slot, which is
  // more correct — a game is shelved at most once, so removing one frees others
  // it was crowding out — and also means "what replaced it" cannot be read off
  // the shelf it left. It is the difference between what was shelved before and
  // what is shelved now.
  notice: null,
};

function toggle(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * A depth you set outlives the filter you set it under.
 *
 * Every one of these used to clear `depthOverrides`, so turning on a split threw
 * away three shelf depths you had just typed. A key for a column that no longer
 * exists simply never matches, which costs nothing; wiping the lot to avoid that
 * cost everything.
 */
function reduce(state, action) {
  switch (action.type) {
    case 'axis':
      return { ...state, axes: toggle(state.axes, action.key) };
    case 'own':
      return { ...state, owned: toggle(state.owned, action.id) };
    case 'ownMany':
      return { ...state, owned: [...new Set([...state.owned, ...action.ids])] };
    // Pinning something you do not own is still meaningful: it says "whatever
    // else changes, keep this in". Blocking beats pinning, because "I want rid
    // of this" is the stronger statement.
    case 'pin':
      return { ...state,
               pinned: toggle(state.pinned, action.id),
               blocked: state.blocked.filter((x) => x !== action.id),
               notice: action.was
                 ? { kind: state.pinned.includes(action.id) ? 'unpin' : 'pin',
                     id: action.id, name: action.name, was: action.was }
                 : null };
    case 'block':
      return { ...state,
               blocked: toggle(state.blocked, action.id),
               pinned: state.pinned.filter((x) => x !== action.id),
               notice: action.was
                 ? { kind: state.blocked.includes(action.id) ? 'unblock' : 'block',
                     id: action.id, name: action.name, was: action.was }
                 : null };
    case 'dismiss':
      return { ...state, notice: null };
    case 'depth': {
      const next = { ...state.depthOverrides };
      if (action.value == null) delete next[action.key];
      else next[action.key] = action.value;
      return { ...state, depthOverrides: next };
    }
    case 'rows':
      return { ...state, rowCount: action.value, rowEdges: null };
    case 'rowEdge': {
      const edges = [...(state.rowEdges ?? action.current)];
      edges[action.at] = action.value;
      return { ...state, rowEdges: edges };
    }
    case 'addRow': {
      if (state.rowCount >= 6) return state;
      return { ...state, rowCount: state.rowCount + 1, rowEdges: action.edges };
    }
    case 'dropRow': {
      if (state.rowCount <= 2) return state;
      const edges = [...action.edges];
      edges.splice(Math.min(action.at, edges.length - 1), 1);
      return { ...state, rowCount: state.rowCount - 1, rowEdges: edges };
    }
    case 'columns':
      return { ...state, columns: action.value };
    case 'mineOnly':
      return { ...state, mineOnly: !state.mineOnly };
    case 'limit':
      return {
        ...state,
        limits: state.limits.map((l, i) => (i === action.at ? { ...l, ...action.value } : l)),
      };
    case 'panel':
      return { ...state, panel: state.panel === action.key ? null : action.key };
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

/** The limit list, as the three things `buildGrid` understands. */
export function limitsFor(limits) {
  const live = (kind, scope) =>
    limits.find((l) => l.on && l.kind === kind && l.scope === scope);
  const perShelf = live('count', 'shelf');
  const total = live('count', 'total');
  return {
    // Reading the curve is itself a per-shelf limit; with it off, a shelf takes
    // the number you set and nothing recomputes behind you.
    capacity: live('returns', 'shelf') ? 'auto' : (perShelf?.value ?? 5),
    perShelfCap: perShelf ? perShelf.value : null,
    budget: total ? total.value : null,
  };
}

export function useCollection(contract) {
  const [state, dispatch] = useReducer(reduce, initial);

  // Indexed once. `buildGrid` takes either the raw contract or the index, and
  // re-flattening half a megabyte on every click is the difference between a
  // control that responds and one that stutters.
  const ix = useMemo(() => indexContract(contract), [contract]);

  // "My collection" does not mean "hide everything else". It means every game
  // you own holds a place, and the rest of the shelf fills from the whole
  // corpus with things you do not own — so what you are looking at is your
  // collection and what would best complete it. Filtering the corpus down to
  // your games could only ever show you what you already knew.
  const keepers = useMemo(
    () => (state.mineOnly ? [...new Set([...state.pinned, ...state.owned])] : state.pinned),
    [state.mineOnly, state.pinned, state.owned]);

  const built = useMemo(() => buildGrid(ix, {
    axes: state.axes,
    columns: state.columns,
    rowCount: state.rowCount,
    rowEdges: state.rowEdges,
    owned: state.owned,
    keepers,
    banned: state.blocked,
    depthOverrides: state.depthOverrides,
    ...limitsFor(state.limits),
    alternatesLimit: 6,
  }), [ix, state.axes, state.columns, state.rowCount, state.rowEdges, state.owned,
       keepers, state.blocked, state.depthOverrides, state.limits]);

  const actions = useMemo(() => ({
    toggleAxis: (key) => dispatch({ type: 'axis', key }),
    own: (id) => dispatch({ type: 'own', id }),
    ownMany: (ids) => dispatch({ type: 'ownMany', ids }),
    // `was` is the set of ids shelved at the moment you pressed the button.
    // Without it the interface can only say what you did, never what happened.
    pin: (id, was, name) => dispatch({ type: 'pin', id, was, name }),
    block: (id, was, name) => dispatch({ type: 'block', id, was, name }),
    dismiss: () => dispatch({ type: 'dismiss' }),
    setDepth: (key, value) => dispatch({ type: 'depth', key, value }),
    setRows: (value) => dispatch({ type: 'rows', value }),
    setRowEdge: (at, value, current) => dispatch({ type: 'rowEdge', at, value, current }),
    setColumns: (value) => dispatch({ type: 'columns', value }),
    addRow: (edges) => dispatch({ type: 'addRow', edges }),
    dropRow: (at, edges) => dispatch({ type: 'dropRow', at, edges }),
    toggleMineOnly: () => dispatch({ type: 'mineOnly' }),
    togglePanel: (key) => dispatch({ type: 'panel', key }),
    setLimit: (at, value) => dispatch({ type: 'limit', at, value }),
    open: (game) => dispatch({ type: 'open', game }),
    reset: () => dispatch({ type: 'reset' }),
  }), []);

  const has = useCallback((list, id) => list.includes(id), []);
  return { state, built, actions, has };
}
