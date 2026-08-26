import { useMemo } from 'react';
import { analyse } from '../analysis/index.js';
import Button from '../primitives/Button.jsx';
import DepthField from '../primitives/DepthField.jsx';
import Board from './Board.jsx';
import Cell from './Cell.jsx';
import { cellLabeller } from './labels.js';
import css from './Collection.module.css';

/**
 * The collection, however it happens to be cut.
 *
 * The page is the grid, whatever size the grid is: one shelf with no axes on,
 * thirty-five with both. It does not choose a rendering based on that — `Cell`
 * draws a shelf and `Board` arranges shelves, and the unsplit screen is one
 * `Cell` at `full`. This file used to branch, and `Board` branched twice more.
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

/** The depth most shelves came out at, for the field to show untouched. */
function typical(built) {
  const depths = built.grid.map((c) => c.picks.length).filter((n) => n > 0);
  if (!depths.length) return 0;
  const counts = new Map();
  for (const d of depths) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/**
 * Bring every shelf to the depth it reads, in whichever direction it is out.
 *
 * Splitting deals the collection out rather than choosing a new one, so a
 * freshly split grid holds what it held before and every shelf has room. But
 * the grid changes shape in the other direction too: dropping a band packs 272
 * games into 28 shelves instead of 35, and six of them end up holding 52 games
 * more than they read. Counting only the shortfall meant the prompt went silent
 * exactly when the grid was most out of shape — you could drop a row and be
 * offered nothing at all.
 *
 * So it fits rather than fills, and says which way. A shelf that is short can
 * only be filled if something is actually waiting for it; a shelf that is over
 * can always be trimmed, so that half needs no such guard.
 */
function Fit({ built, actions }) {
  let short = 0;
  let over = 0;
  for (const c of built.grid) {
    const want = built.depths?.cellDepth?.get(c.key)?.depth ?? 0;
    if (c.picks.length < want && c.alternates.length) short += 1;
    if (c.picks.length > want) over += 1;
  }
  if (!short && !over) return null;
  const shelves = (n) => `${n} ${n === 1 ? 'shelf' : 'shelves'}`;
  return (
    <div className={css.addRow}>
      <Button onClick={() => actions.fill(built.filled)}>Fit the shelves</Button>
      <span className={css.addNote}>
        {short > 0 && `${shelves(short)} ${short === 1 ? 'has' : 'have'} room`}
        {short > 0 && over > 0 && ', and '}
        {over > 0 && `${shelves(over)} ${over === 1 ? 'holds' : 'hold'} more than `
          + `${over === 1 ? 'it reads' : 'they read'}`}
        {' — this brings each one to the depth it reads.'}
        {over > 0 && ' Games past that depth come off the shelf.'}
      </span>
    </div>
  );
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
      // The same key the one shelf's own control writes to. It used to set the
      // register default instead, which the shelf's own number outranks — so on
      // a collection you had emptied by hand, "add the next game" did nothing.
      ? { name: depths.cell.nextName, gain: depths.cell.next,
          key: 'collection', depth: depths.cell.depth, cell: null }
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
      <Button onClick={() => actions.setDepth(best.key, best.depth + 1)}>
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

export default function Collection({ built, state, actions }) {
  const { grid, axes } = built;
  // Whatever has something to say about this collection, in registration order.
  // An analysis that returns null does not render a heading over nothing.
  const found = useMemo(() => analyse({ built, state }), [built, state]);
  const total = grid.reduce((n, c) => n + c.picks.length, 0);

  // With no axes there is one shelf, and it is drawn by exactly the component a
  // grid is made of, at the size a thing you are looking at deserves. There is
  // no separate unsplit rendering any more: that branch, and the two inside
  // `Board`, were four ways of drawing one idea.
  const one = axes.length === 0 ? grid[0] : null;

  return (
    <div className={css.view}>
      <div className={css.split}>
        <aside className={css.side}>
          {found.map(({ analysis, data }) => (
            <analysis.View key={analysis.id} data={data} built={built} state={state}
                           actions={actions} onOpen={actions.focusGame} />
          ))}
          {one && <Why cell={built.depths?.cell} />}
        </aside>

        <div className={css.main}>
          {/* One shelf needs no heading of its own above it: the shelf has one,
              and it carries the same depth control the register head did. Two
              headings saying "the collection" over one list was the duplication
              this whole change is about. */}
          {!one && (
            <div className={css.head}>
              <h2 className={css.title}>
                {axes.length === 1 ? 'One shelf per group' : `${grid.length} shelves`}
              </h2>
              <PerShelf built={built} state={state} actions={actions} />
              <span className={css.sub}>{total} games</span>
            </div>
          )}
          <Fit built={built} actions={actions} />
          <AddNext built={built} state={state} actions={actions} />
          {one ? (
            <Cell cell={one} built={built} state={state} actions={actions}
                  size="full" onOpen={actions.focusGame} />
          ) : (
            <Board built={built} state={state} actions={actions}
                   onOpen={actions.focusGame} />
          )}
        </div>
      </div>
    </div>
  );
}
