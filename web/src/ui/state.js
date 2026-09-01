/**
 * Everything the interface can change, and the collection that comes out of it.
 *
 * One object, one recompute. `axes` is what makes it a collection or a grid: an
 * empty list is a single cell holding the whole corpus, one axis gives columns,
 * two gives shelves. Nothing else in here knows the difference.
 */

import { useCallback, useMemo, useReducer, useTransition } from 'react';
import { DEFAULT_COLUMNS, buildGrid, indexContract } from '../engine/index.js';

export const AXES = [
  { key: 'players', label: 'player count' },
  { key: 'weight', label: 'weight' },
];

const EMPTY = [];

const initial = {
  // Nothing on: the collection is one shelf holding the whole space. Splitting
  // is something a reader chooses, not the state the app starts in.
  axes: [],
  // What the collection holds right now, so splitting can *deal* it rather than
  // choose a new one. `null` is "nothing dealt yet — every shelf fills to its
  // depth", which is where an unsplit collection lives and where filling puts
  // it back. Splitting captures it; every control that adds or drops a game
  // edits it, so it is the collection rather than a snapshot of one.
  held: null,
  // Where each held game sat when it was captured, so a re-deal puts it back
  // rather than recomputing where it "belongs".
  heldAt: null,
  owned: EMPTY, pinned: EMPTY, blocked: EMPTY,
  // Which held games are held *because* they were pinned, and would not
  // otherwise be in the collection. `held` is a flat list of ids and cannot say
  // why a game is in it, so unpinning had nothing to undo: a pin added a game
  // and the unpin left it behind for good, outranking the selection on every
  // rebuild. Pinning something already shelved records nothing, because that
  // game is there on its own merit and unpinning it should change nothing.
  pinAdded: EMPTY,
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
    { kind: 'returns', scope: 'shelf', on: true, value: 45 },
    { kind: 'budget', scope: 'total', on: false, value: 400 },
    { kind: 'volume', scope: 'total', on: false, value: 60 },
  ],
  // How many games a shelf takes when nothing else has been said about that
  // shelf. `null` is "each one reads its own curve". It is not in the limits
  // list because it already has a place on the thing it counts — the number in
  // the register head — and a control in two places is two things to keep in
  // step. Neither is a total: how many games there are is a readout in the bar,
  // not something to set.
  perShelf: null,
  panel: null,         // which axis is being configured, if any
  // What you are looking at, if you have opened something. One field for what
  // used to be two — a selected shelf and an open game — because they are the
  // same act: a thing you clicked, shown at full size on one surface. `from`
  // remembers the shelf a game was opened from, so there is somewhere to go
  // back to and never two panels stacked.
  //
  //   { kind: 'cell' | 'game', key?, game?, from? }
  //
  // Analyses scope to it when it is a shelf: a five-game shelf moves visibly
  // when one game changes, where a 272-game collection cannot — one game in 272
  // is a third of a percent, and no measure can make that four pixels.
  focus: null,
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
    // Splitting rearranges the collection; it never rechooses it. `held` is
    // taken at the moment the axis goes on, from what is on the shelves right
    // then, so the games survive the split and only their arrangement changes.
    case 'axis':
      return { ...state,
               axes: toggle(state.axes, action.key),
               held: action.held?.ids ?? null,
               heldAt: action.held?.at ?? null,
               // The shelves are different shelves now, so whatever was open
               // names one that may not exist.
               focus: null };
    /**
     * Put one named game in, on the shelf it was offered for.
     *
     * "Add X" used to raise a depth by one and let the next allocation decide
     * who filled the new slot, which is a different act: the label named the
     * runner-up of a probe that ignores blocks and pins, and the rebuild
     * answered a fresh auction. Adding the id to `held` makes the two the same
     * thing by construction.
     *
     * `bump` is for a shelf that was asked for a number — see `AddNext`. It
     * goes through the same map as any typed depth, so clearing that shelf's
     * number afterwards clears this too.
     */
    case 'add': {
      const ids = state.held ?? action.held?.ids ?? [];
      if (ids.includes(action.id)) return state;
      const at = new Map(state.held == null
        ? (action.held?.at ?? []) : (state.heldAt ?? []));
      if (action.cell != null) at.set(action.id, action.cell);
      const depthOverrides = action.bump
        ? { ...state.depthOverrides, [action.bump.key]: action.bump.value }
        : state.depthOverrides;
      return { ...state, held: [...ids, action.id], heldAt: at, depthOverrides };
    }
    // Fill every shelf to the depth it reads, keeping everything already held.
    case 'fill':
      return { ...state,
               held: action.held?.ids ?? state.held,
               heldAt: action.held?.at ?? state.heldAt };
    case 'own':
      return { ...state, owned: toggle(state.owned, action.id) };
    case 'ownMany':
      return { ...state, owned: [...new Set([...state.owned, ...action.ids])] };
    // Pinning something you do not own is still meaningful: it says "whatever
    // else changes, keep this in". Blocking beats pinning, because "I want rid
    // of this" is the stronger statement.
    // A pin adds a game to the collection, so the collection grows by one.
    // Without this the pinned game landed in a shelf already full to its deal
    // and pushed three others out — a pin is an addition, not a swap.
    // An unpin undoes the addition a pin made, and only that. `pinned.includes`
    // is the pre-toggle read, so it is what tells the two directions apart.
    case 'pin': {
      const unpinning = state.pinned.includes(action.id);
      const added = state.pinAdded.includes(action.id);
      const joins = !unpinning && state.held != null
        && !state.held.includes(action.id);
      let held = state.held;
      let heldAt = state.heldAt;
      if (joins) held = [...held, action.id];
      // Only a game the pin itself put there comes back out. One the reader
      // already had, or one a later fill chose on merit, stays.
      if (unpinning && added && held != null) {
        held = held.filter((x) => x !== action.id);
        if (heldAt?.has(action.id)) {
          heldAt = new Map(heldAt);
          heldAt.delete(action.id);
        }
      }
      return { ...state,
               held,
               heldAt,
               pinned: toggle(state.pinned, action.id),
               pinAdded: joins ? [...state.pinAdded, action.id]
                 : state.pinAdded.filter((x) => x !== action.id),
               blocked: state.blocked.filter((x) => x !== action.id),
               notice: action.was
                 ? { kind: unpinning ? 'unpin' : 'pin',
                     id: action.id, name: action.name, was: action.was }
                 : null };
    }
    /**
     * Blocking takes a game out of the running. The shelf keeps its size.
     *
     * `held` is deliberately left alone. It is what the collection is *meant*
     * to hold, so the shelf goes on asking for the same number and the ban
     * simply loses that slot to the next game — `allocate` skips a seeded game
     * that is also rejected ("banned wins"), and the auction fills the gap.
     *
     * Filtering it out instead made blocking mean two different things with
     * nothing on screen to say which. Measured on a split grid: 50 games, block
     * one, and an undealt collection replaced it (50) while a dealt one shrank
     * (49) — and setting the register made it replace again (42 → 42). Which
     * you got depended on whether you had ever split or pressed Fit.
     *
     * It also makes unblocking symmetric: the game is still in `held` and still
     * has its `heldAt`, so it goes back where it was.
     */
    case 'block':
      return { ...state,
               held: state.held,
               heldAt: state.heldAt,
               blocked: toggle(state.blocked, action.id),
               pinned: state.pinned.filter((x) => x !== action.id),
               // It is out of `held` and out of `pinned`, so there is no
               // addition left for an unpin to undo.
               pinAdded: state.pinAdded.filter((x) => x !== action.id),
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
    case 'perShelf':
      return { ...state, perShelf: action.value };
    case 'limit':
      return {
        ...state,
        limits: state.limits.map((l, i) => (i === action.at ? { ...l, ...action.value } : l)),
      };
    // Clicking the shelf you already have open closes it, the way a toggle
    // reads. Clicking a game always opens the game, because you got there from
    // somewhere and going back is the way out.
    case 'focus': {
      const { kind, key, game, from } = action;
      const now = state.focus;
      if (kind === 'cell' && now?.kind === 'cell' && now.key === key) {
        return { ...state, focus: null };
      }
      return { ...state, focus: { kind, key, game, from } };
    }
    case 'unfocus':
      return { ...state, focus: null };
    case 'back':
      return { ...state, focus: state.focus?.from ?? null };
    case 'axis2':
      return state;
    case 'panel':
      return { ...state, panel: state.panel === action.key ? null : action.key };
    default:
      return state;
  }
}

/** The limits and the shelf default, as the things `buildGrid` understands. */
function limitsFor(limits, perShelf) {
  const live = (kind) => limits.find((l) => l.on && l.kind === kind);
  const returns = live('returns');
  return {
    // Reading the curve is itself a per-shelf limit; with it off, a shelf takes
    // the number you set and nothing recomputes behind you.
    capacity: returns ? 'auto' : (perShelf ?? 5),
    // How much a game must still add for a shelf to keep taking them, as a share
    // of what its first one added. Held here rather than read off the contract
    // because it is a thing to set, not a constant the model was fitted with.
    autoDepthLeftover: returns ? (returns.value ?? 45) / 100 : null,
    perShelfCap: perShelf,
    // Money and shelf volume are the only totals worth setting, and neither has
    // data behind it yet.
    budget: live('budget')?.value ?? live('volume')?.value ?? null,
  };
}

export function useCollection(contract) {
  const [state, dispatch] = useReducer(reduce, initial);

  /**
   * Rebuilding is synchronous, so nothing can paint while it runs.
   *
   * `buildGrid` is one long task on the render thread — a spinner started when
   * the work begins never gets a frame to appear in. A transition is the way
   * round it: React paints the tree it already has, with `pending` true, before
   * it starts the render that does the work. Measured, what a reader waits for:
   * 24ms to rebuild a dealt grid, 470ms for a cold two-split, and 4.7s with the
   * returns bar dragged to 5%.
   *
   * Only the things that rebuild go through it. Opening a shelf or a panel
   * changes no numbers, and making those wait behind a transition would make
   * the cheap half of the interface feel like the expensive half.
   */
  const [pending, startTransition] = useTransition();
  const slow = useCallback((action) => startTransition(() => dispatch(action)), []);

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
    held: state.held,
    heldAt: state.heldAt,
    depthOverrides: state.depthOverrides,
    ...limitsFor(state.limits, state.perShelf),
    alternatesLimit: 6,
  }), [ix, state.axes, state.columns, state.rowCount, state.rowEdges, state.owned,
       keepers, state.blocked, state.held, state.heldAt, state.depthOverrides,
       state.limits, state.perShelf]);

  const actions = useMemo(() => ({
    // `held` is what is on the shelves at the moment the axis is toggled, so
    // the split deals the collection instead of choosing a new one. Turning the
    // last axis off passes nothing: one shelf holding everything has no deal to
    // honour, and that is where the collection reads its own depth again.
    toggleAxis: (key, held) => slow({ type: 'axis', key, held }),
    fill: (held) => slow({ type: 'fill', held }),
    // The game, the shelf it was offered for, what is on screen now (so an
    // undealt collection has something to be added *to*), and the ask to raise
    // if that shelf was given a number.
    add: (id, cell, held, bump) => slow({ type: 'add', id, cell, held, bump }),
    own: (id) => slow({ type: 'own', id }),
    ownMany: (ids) => slow({ type: 'ownMany', ids }),
    // `was` is the set of ids shelved at the moment you pressed the button.
    // Without it the interface can only say what you did, never what happened.
    pin: (id, was, name) => slow({ type: 'pin', id, was, name }),
    block: (id, was, name) => slow({ type: 'block', id, was, name }),
    dismiss: () => dispatch({ type: 'dismiss' }),
    setDepth: (key, value) => slow({ type: 'depth', key, value }),
    setRows: (value) => slow({ type: 'rows', value }),
    setRowEdge: (at, value, current) => slow({ type: 'rowEdge', at, value, current }),
    setColumns: (value) => slow({ type: 'columns', value }),
    addRow: (edges) => slow({ type: 'addRow', edges }),
    dropRow: (at, edges) => slow({ type: 'dropRow', at, edges }),
    toggleMineOnly: () => slow({ type: 'mineOnly' }),
    togglePanel: (key) => dispatch({ type: 'panel', key }),
    // One surface, and the thing you clicked is its subject.
    focusCell: (key) => dispatch({ type: 'focus', kind: 'cell', key }),
    focusGame: (game, from) => dispatch({ type: 'focus', kind: 'game', game, from }),
    unfocus: () => dispatch({ type: 'unfocus' }),
    back: () => dispatch({ type: 'back' }),
    setLimit: (at, value) => slow({ type: 'limit', at, value }),
    setPerShelf: (value) => slow({ type: 'perShelf', value }),
  }), [slow]);

  const has = useCallback((list, id) => list.includes(id), []);
  return { state, built, actions, has, pending };
}
