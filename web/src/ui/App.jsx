import { useEffect, useState } from 'react';
import { SplitBar } from './primitives/index.js';
import { AXES, useCollection } from './state.js';
import AxisPanel from './views/AxisPanel.jsx';
import { Blocked, Notice } from './views/Notice.jsx';
import Collection from './views/Collection.jsx';
import Mine from './views/Mine.jsx';
import GameDrawer from './views/GameDrawer.jsx';
import { toGameView } from './game/view.js';
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

function standfirst(page, built, owned) {
  if (page === 'mine') {
    return owned
      ? 'Your games compete like any other. Pin one and it holds its place regardless.'
      : 'Nothing yet. Add what you own and the collection fills around it instead.';
  }
  const total = built.grid.reduce((n, c) => n + c.picks.length, 0);
  if (built.mineOnly) {
    return `Built out of your ${owned} games and nothing else. What a game `
      + 'carries here is what it carries for you — and a shelf you have nothing '
      + 'for shows up empty.';
  }
  if (built.axes.length === 0) {
    if (!total) {
      return 'Empty. Add games one at a time and each will be the one that '
        + 'reaches furthest into what the others leave uncovered.';
    }
    const worked = built.depths?.cell?.auto;
    return `${total} games that between them reach as much of the board-game space `
      + `as anything can.${worked ? ' It stopped there because the next one would '
      + 'not have added enough to be worth the space.' : ''}`;
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
  const { state, built, actions } = useCollection(contract);
  const total = built.grid.reduce((n, c) => n + c.picks.length, 0);

  const open = state.open
    ? { ...state.open, ...toGameView(built.ix, built.ix.rowOf.get(state.open.id), {
        owned: state.owned.includes(state.open.id),
        pinned: state.pinned.includes(state.open.id),
        blocked: state.blocked.includes(state.open.id),
        reason: state.open.reason ?? null,
      }) }
    : null;

  return (
    <div className={css.app}>
      <header className={css.top}>
        <div>
          <h1 className={css.title}>
            {page === 'mine' ? 'My games' : 'The collection'}
          </h1>
          <p className={css.standfirst}>
            {standfirst(page, { ...built, mineOnly: state.mineOnly }, state.owned.length)}
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
                onToggle={actions.toggleAxis} onOpen={actions.togglePanel}
                openKey={state.panel} ownedCount={state.owned.length}
                onlyMine={{ on: state.mineOnly, toggle: actions.toggleMineOnly }}>
        <Blocked state={state} built={built} actions={actions} />
      </SplitBar>
      <AxisPanel which={state.axes.includes(state.panel) ? state.panel : null}
                 built={built} state={state} actions={actions} />
      <Notice state={state} built={built} actions={actions} />

      {page === 'collection' && (
        <Collection built={built} state={state} actions={actions} onOpen={actions.open} />
      )}
      {page === 'mine' && (
        <Mine built={built} state={state} actions={actions} onOpen={actions.open} />
      )}

      <GameDrawer game={open} built={built} state={state} actions={actions}
                  onClose={() => actions.open(null)} />
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
