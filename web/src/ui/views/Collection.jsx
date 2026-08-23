import { useMemo } from 'react';
import { analyse } from '../analysis/index.js';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import Button from '../primitives/Button.jsx';
import DepthField from '../primitives/DepthField.jsx';
import { sharesOf } from '../state.js';
import Board, { shelvedNow } from './Board.jsx';
import { cellLabeller } from './labels.js';
import css from './Collection.module.css';

/**
 * The collection, however it happens to be cut.
 *
 * With no axes there is one shelf and it is worth reading in full, so this is a
 * register: every game, what it does, and how much of the whole it carries.
 * Split it and the register gives way to `Board`, because thirty-five shelves
 * of five are a shape rather than a list.
 */

/**
 * How many games a shelf takes, by default.
 *
 * Not an override: it is the number a shelf uses when nobody has said otherwise
 * about that shelf, so the ＋ and − in a cell still win. It is here rather than
 * only in the limits list because it is the number a reader reaches for most,
 * and it belongs beside the thing it counts.
 */
function PerShelf({ built, state, actions }) {
  // Untouched it shows what the shelves are actually doing rather than a
  // placeholder: the one shelf's depth unsplit, and the commonest answer once
  // there are many.
  const shown = state.perShelf ?? typical(built);
  return (
    <span className={css.depth}>
      <DepthField value={shown} set={state.perShelf != null}
                  onChange={(v) => actions.setPerShelf(v)}
                  onClear={() => actions.setPerShelf(null)} />
    </span>
  );
}

/** The depth most shelves came out at, for the field to show while it is auto. */
function typical(built) {
  const depths = built.grid.map((c) => c.picks.length).filter((n) => n > 0);
  if (!depths.length) return 0;
  const counts = new Map();
  for (const d of depths) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/**
 * The one game it would take next, wherever that is.
 *
 * Unsplit there is one shelf and one answer. Split, every shelf has a next in
 * line and the useful one is whichever would add the most — so the button names
 * that game and says which shelf it lands on. It is the same question either
 * way, which is the point: splitting rearranges the collection, it does not
 * change what you can ask of it.
 */
function AddNext({ built, state, actions }) {
  const { grid, depths, axes } = built;
  const label = cellLabeller(built);

  const best = axes.length === 0
    ? (depths?.cell?.nextName
      ? { name: depths.cell.nextName, gain: depths.cell.next,
          key: null, depth: depths.cell.depth, cell: null }
      : null)
    : grid
      .flatMap((c) => (c.alternates[0]
        ? [{ name: c.alternates[0].name, gain: c.alternates[0].gain,
             key: `cell:${c.key}`, depth: c.picks.length, cell: c.key }]
        : []))
      .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))[0];
  if (!best) return null;

  const last = axes.length === 0
    ? (grid[0]?.picks?.length ? grid[0].picks[grid[0].picks.length - 1].gain : null)
    : (grid.find((c) => c.key === best.cell)?.gains?.slice(-1)[0] ?? null);

  return (
    <div className={css.addRow}>
      <Button onClick={() => (best.key
        ? actions.setDepth(best.key, best.depth + 1)
        : actions.setPerShelf(best.depth + 1))}>
        ＋ Add {best.name}
      </Button>
      <span className={css.addNote}>
        {best.cell ? `Goes on ${label(best.cell)}. ` : ''}
        {last == null
          ? `Adds ${best.gain?.toFixed(2)} — the most of anything left.`
          : `Adds ${best.gain?.toFixed(2)}, against ${last.toFixed(2)} for the last one in.`}
      </span>
    </div>
  );
}

function Why({ cell }) {
  if (!cell?.curve?.length) return null;
  const top = Math.max(...cell.curve);
  const before = cell.depth > 0 ? cell.curve[cell.depth - 1] : null;
  const after = cell.curve[cell.depth] ?? null;
  return (
    <div className={css.block}>
      <h2 className={css.label}>{cell.depth === 0 ? 'What it would take' : `Why ${cell.depth}`}</h2>
      <div className={css.curve}>
        {cell.curve.map((v, i) => (
          <span key={i} className={`${css.bar} ${i >= cell.depth ? css.past : ''}`.trim()}
                style={{ height: `${Math.max(2, Math.round((v / top) * 100))}%`,
                         opacity: i < cell.depth ? (0.4 + (v / top) * 0.6).toFixed(2) : 1 }} />
        ))}
      </div>
      {before != null && after != null && (
        <span className={css.cliff}>
          <b>{before.toFixed(2)} → {after.toFixed(2)}</b>
          <span>between game {cell.depth} and game {cell.depth + 1}</span>
        </span>
      )}
      <p className={css.note}>
        Each bar is what one more game would add to what the others already
        cover. It keeps going while that is at least {Math.round(
          (cell.bar / (cell.curve[0] || 1)) * 100)}% of what the first one added
        — the grey bars are the ones that were not.
      </p>
    </div>
  );
}

export default function Collection({ built, state, actions, onOpen }) {
  const { ix, grid, weights, depths, axes } = built;
  // Whatever has something to say about this collection, in registration order.
  // An analysis that returns null does not render a heading over nothing.
  const found = useMemo(() => analyse({ built, state }), [built, state]);

  const shelf = axes.length === 0 ? grid[0] : null;
  const rows = useMemo(
    () => (shelf ? shelf.picks.map((p) => ix.rowOf.get(p.id)) : []),
    [shelf, ix]);
  // Sorted by what each carries, because that is what the heading claims. In
  // allocation order it was not: pinning a game already on the shelf seeds it
  // first and re-orders everything after it, which read as a reshuffle when
  // nothing about the collection had changed.
  const register = useMemo(() => {
    if (!shelf) return [];
    const carried = sharesOf(ix, weights, rows);
    return shelf.picks
      .map((p, i) => ({ pick: p, carries: carried[i] }))
      .sort((a, b) => b.carries - a.carries);
  }, [shelf, ix, weights, rows]);

  const total = grid.reduce((n, c) => n + c.picks.length, 0);

  return (
    <div className={css.view}>
      <div className={css.split}>
        <aside className={css.side}>
          {found.map(({ analysis, data }) => (
            <analysis.View key={analysis.id} data={data} built={built} state={state}
                           actions={actions} onOpen={onOpen} />
          ))}
          {shelf && <Why cell={depths?.cell} />}
        </aside>

        <div className={css.main}>
          {shelf ? (
            <>
              <div className={css.head}>
                <h2 className={css.title}>Every game in it</h2>
                <PerShelf built={built} state={state} actions={actions} />
                <span className={css.sub}>
                  ordered by how much of the collection each carries
                </span>
              </div>
              <AddNext built={built} state={state} actions={actions} />
              {shelf.picks.length === 0 && (
                <p className={css.blank}>
                  Empty. The bars on the left are what each game would add if you
                  took them in order — the first one adds the most because
                  nothing is covered yet.
                </p>
              )}
              <div className={css.list}>
                {register.map(({ pick: p, carries }) => (
                  <div key={p.id} className={css.entry}>
                    <GameItem
                      game={toGameView(ix, ix.rowOf.get(p.id), {
                        carries,
                        owned: state.owned.includes(p.id),
                        pinned: state.pinned.includes(p.id),
                        blocked: state.blocked.includes(p.id),
                      })}
                      onOpen={onOpen}
                      onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                      onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
                  </div>
                ))}
              </div>
              {shelf.alternates?.length > 0 && (
                <details className={css.deck}>
                  <summary className={css.deckHead}>
                    {shelf.alternates.length} on deck — the next in line, if you
                    make room
                  </summary>
                  <div className={css.list}>
                    {shelf.alternates.map((a) => {
                      const row = ix.rowOf.get(a.id);
                      if (row === undefined) return null;
                      return (
                        <div key={a.id} className={css.entry}>
                          <GameItem
                            game={toGameView(ix, row, {
                              owned: state.owned.includes(a.id),
                              pinned: state.pinned.includes(a.id),
                              blocked: state.blocked.includes(a.id),
                            })}
                            onOpen={onOpen}
                            onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                            onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
              <p className={css.foot}>
                Carries is the share of everything the collection reaches that
                would be lost without that game. The shares do not add to 100 —
                games overlap, and covering the same ground twice is what the
                selection is built to avoid.
              </p>
            </>
          ) : (
            <>
              <div className={css.head}>
                <h2 className={css.title}>
                  {axes.length === 1 ? 'One shelf per group' : 'Thirty-five shelves'}
                </h2>
                <PerShelf built={built} state={state} actions={actions} />
                <span className={css.sub}>{total} games</span>
              </div>
              <AddNext built={built} state={state} actions={actions} />
              <Board built={built} state={state} actions={actions} onOpen={onOpen} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
