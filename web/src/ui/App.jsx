import { useEffect, useState } from 'react';
import { SplitBar } from './primitives/index.js';
import { AXES, useCollection } from './state.js';
import AxisPanel from './views/AxisPanel.jsx';
import FillUntil from './views/FillUntil.jsx';
import { Blocked, Notice } from './views/Notice.jsx';
import Collection from './views/Collection.jsx';
import { collectionOf, shelvedNow } from './shelved.js';
import Mine from './views/Mine.jsx';
import Focus from './views/Focus.jsx';
import css from './App.module.css';
import './tokens.css';

/**
 * One collection, three pages.
 *
 * The split control sits above the result on every page because it is the input
 * to it: nothing on means one shelf holding the whole space, one axis means
 * columns, two means a grid. There is no "aggregate view" and no "grid view" —
 * that was two names for one object seen at two settings.
 */

const PAGES = [
  { key: 'collection', label: 'Collection' },
  { key: 'mine', label: 'My games' },
];

/**
 * Take what it needs, never a spread of `built`.
 *
 * `built` carries two lazy getters — `data` and `filled` — and spreading an
 * object *invokes* its getters. `{ ...built, mineOnly }` therefore ran a whole
 * second `buildGrid` on every single render: measured, 699 of the 734
 * `scoreAll` calls behind one click came from `get filled`, called by `App`.
 */
function standfirst(page, built, owned, pinnedMine) {
  if (page === 'mine') {
    return owned
      ? 'Your games compete like any other. Pin one and it holds its place regardless.'
      : 'Nothing yet. Add what you own and the collection fills around it instead.';
  }
  const total = built.grid.reduce((n, c) => n + c.picks.length, 0);
  if (pinnedMine && pinnedMine === owned) {
    return `All ${owned} of your games are pinned, so each holds a place, and the `
      + 'rest is what would best complete them. Unpin one and it takes its '
      + 'chances with everything else.';
  }
  if (pinnedMine) {
    return `${pinnedMine} of your ${owned} games are pinned and hold a place `
      + 'regardless; the others compete like anything else.';
  }
  if (built.axes.length === 0) {
    if (!total) {
      return 'Empty. Add games one at a time and each will be the one that '
        + 'reaches furthest into what the others leave uncovered.';
    }
    return `${total} games that between them reach as much of the board-game space `
      + 'as anything can. It stops where the next game would not add enough to be '
      + 'worth the space.';
  }
  if (built.axes.length === 1) {
    return 'The same question asked once per group. Each fills until its own '
      + 'returns run out, so they are not the same height — that is the answer, '
      + 'not a defect.';
  }
  return 'Each shelf holds as many games as its column and its row will allow, '
    + 'whichever is fewer.';
}

export default function App({ contract }) {
  const [page, setPage] = useState('collection');
  const { state, built, actions, pending } = useCollection(contract);
  const total = built.grid.reduce((n, c) => n + c.picks.length, 0);
  // "Build on mine" is pressed when every game you own is pinned, because that
  // is exactly what it does. Release one from its own pin and the button reads
  // as not-pressed again, which is true: it is no longer the whole set.
  const pinnedMine = state.owned.filter((id) => state.pinned.includes(id)).length;
  const allMinePinned = state.owned.length > 0 && pinnedMine === state.owned.length;


  return (
    <div className={css.app}>
      {/* Rebuilding is one long synchronous task, so this has to be painted
          before the work starts rather than while it runs — which is what the
          transition in `useCollection` is for. It then holds itself invisible
          for `--wait`, so the rebuilds nobody waits for never show it.
          Indeterminate: the allocator cannot say how far through it is. */}
      <div className={`${css.progress} ${pending ? css.armed : ''}`.trim()} role="status"
           aria-live="polite" aria-label={pending ? 'Working out the collection' : ''}>
        {pending && <span className={css.bar} />}
      </div>
      <header className={css.top}>
        <div>
          <h1 className={css.title}>
            {page === 'mine' ? 'My games' : 'The collection'}
          </h1>
          <p className={css.standfirst}>
            {standfirst(page, built, state.owned.length, pinnedMine)}
          </p>
        </div>
        <nav className={css.nav}>
          {PAGES.map((p) => (
            <button key={p.key} type="button" onClick={() => setPage(p.key)}
                    aria-current={page === p.key ? 'page' : undefined}
                    className={`${css.tab} ${page === p.key ? css.on : ''}`.trim()}>
              {p.label}
            </button>
          ))}
        </nav>
      </header>

      <SplitBar axes={AXES} active={state.axes} count={total}
                onToggle={(key) => actions.toggleAxis(key, collectionOf(built.grid))}
                onOpen={actions.togglePanel}
                openKey={state.panel} ownedCount={state.owned.length}
                buildOnMine={{
                  on: allMinePinned,
                  toggle: () => actions.pinMany(
                    allMinePinned
                      ? state.owned.filter((id) => state.pinned.includes(id))
                      : state.owned.filter((id) => !state.pinned.includes(id)),
                    shelvedNow(built.grid)),
                }}>
        <FillUntil limits={state.limits} onChange={actions.setLimit}
                   leftover={built.ix.defaults?.autoDepthLeftover} />
        <Blocked state={state} built={built} actions={actions} />
      </SplitBar>
      <AxisPanel which={state.axes.includes(state.panel) ? state.panel : null}
                 built={built} state={state} actions={actions} />
      <Notice state={state} built={built} actions={actions} />

      {page === 'collection' && (
        <Collection built={built} state={state} actions={actions} />
      )}
      {page === 'mine' && (
        <Mine built={built} state={state} actions={actions} onOpen={actions.focusGame} />
      )}

      {/* One surface for whatever you have opened — a shelf or a game, never
          both stacked, and never anything sliding over the grid from a side. */}
      <Focus built={built} state={state} actions={actions} />
    </div>
  );
}

/** Loads the contract once, then hands it to the app. */
export function Boot({ src = './grid.contract.json' }) {
  const [contract, setContract] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((c) => { if (live) setContract(c); })
      .catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [src]);

  if (error) return <p className={css.loading}>Could not load the model: {String(error.message)}</p>;
  if (!contract) return <p className={css.loading}>Building the collection…</p>;
  return <App contract={contract} />;
}
