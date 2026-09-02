import { useMemo } from 'react';
import DepthField from '../primitives/DepthField.jsx';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import { cellOverrideKey } from '../../engine/index.js';
import { cellLabeller } from './labels.js';
import { rowsOfPicks, shelvedNow } from '../shelved.js';
import { Expand } from '../icons.jsx';
import css from './Cell.module.css';

/**
 * A shelf, at whichever size you are looking at it.
 *
 * The only thing in the interface that draws a shelf. There used to be four:
 * `Collection` branched on `axes.length === 0` and drew the unsplit collection
 * as a register, `Board` branched again into a column layout and a cell layout,
 * and each of them wrote out "the games on a shelf" its own way. The unsplit
 * screen was not *treated* as a one-cell grid, so it did not behave like one.
 *
 *   mini — the name, the count, the games. Nothing else.
 *   full — all of that, plus the depth control, what is on deck, and the
 *          analyses for this shelf.
 *
 * `full` is the whole of the old unsplit screen, so a grid cell opened up is the
 * collection screen scoped to that cell — which is the point. The difference
 * between the two sizes is *what is worth showing*, never how a shelf works.
 */

/**
 * An empty shelf says one thing; at full size it has room to say what to do
 * about it, which is the whole difference between the two sizes.
 *
 * It used to have a third answer, "nothing of yours", under the old `mineOnly`
 * flag — and it was wrong even then: that flag never filtered the corpus to
 * your games, so an empty shelf under it meant what it always means, that
 * nothing in the corpus reaches here.
 */
const empty = (full) => (full
  ? 'Empty. Add games one at a time and each will be the one that reaches '
    + 'furthest into what the others leave uncovered.'
  : 'nothing reaches here');

/**
 * The depth override key for a shelf.
 *
 * The unsplit collection has no column or row to be named by, so `buildGrid`
 * reads it under `collection` rather than `cell:`. Everything else about the two
 * is identical, and this is the only place that has to know.
 *
 * Scoped by the axes it was typed under, because a one-axis cell key is a bare
 * string and the two axes collide on it — see `cellOverrideKey`.
 */
const depthKeyOf = (cell, axes = []) =>
  (cell?.key ? cellOverrideKey(axes, cell.key) : 'collection');

/**
 * What this shelf is aiming for, which is not always what it holds.
 *
 * A shelf can be short of its depth because the corpus has nothing left to put
 * there. The field shows the number being aimed at; the count beside the games
 * shows what arrived.
 */
const depthOf = (built, cell) => (cell?.key
  ? built.depths?.cellDepth?.get(cell.key)?.depth
  : built.depths?.cell?.depth) ?? cell?.picks?.length ?? 0;

const view = (built, state, row, extra) => toGameView(built.ix, row, {
  ...extra,
  owned: state.owned.includes(built.ix.ids[row]),
  pinned: state.pinned.includes(built.ix.ids[row]),
  blocked: state.blocked.includes(built.ix.ids[row]),
});

/** One more, one fewer. The only control a shelf needs beyond typing a number. */
function PlusMinus({ depthKey, held, next, actions, pinned = 0 }) {
  const set = (n) => actions.setDepth(depthKey, Math.max(0, n));
  return (
    <span className={css.pm}>
      {/* A pin holds a game whatever the selection would rather do, so the
          shelf floors at however many are pinned to it rather than at zero. */}
      <button type="button" aria-label="One fewer here" disabled={held <= pinned}
              title={held <= pinned && pinned
                ? `${pinned === 1 ? 'One game is' : `${pinned} games are`} pinned here`
                : undefined}
              onClick={(e) => { e.stopPropagation(); set(held - 1); }}>−</button>
      <button type="button" aria-label="One more here" disabled={!next}
              onClick={(e) => { e.stopPropagation(); set(held + 1); }}>＋</button>
    </span>
  );
}

export default function Cell({
  cell, built, state, actions, size = 'mini', marks = {}, onFocus, onOpen,
  analyses = null, showName = true, dense = false,
}) {
  const { ix } = built;
  const name = useMemo(() => cellLabeller(built)(cell?.key ?? ''), [built, cell]);
  const held = cell?.picks?.length ?? 0;
  const next = cell?.alternates?.length ?? 0;
  const full = size === 'full';

  const rows = useMemo(
    () => rowsOfPicks(ix, cell?.picks ?? []),
    [cell, ix]);
  const shelved = () => shelvedNow(built.grid);
  /**
   * A game is its own target only on a shelf you have opened.
   *
   * At `mini` the shelf is the target and the games are its contents: one click
   * opens the shelf, and every game on it becomes reachable at once. Before
   * this a cell held five competing targets — the shelf, and five names that
   * each swallowed the click and opened a different overlay — so where you
   * landed depended on hitting the gap between two names.
   *
   * `full` is the shelf you already opened, and the rail's `reason` rows are
   * not in a cell at all, so both stay clickable.
   */
  const item = (row, id, change, extra) => (
    <GameItem key={`${id}${change === 'went' ? ':went' : ''}`}
              variant={full ? 'row' : 'compact'} change={change} showRank={!dense}
              game={view(built, state, row, extra)} onOpen={full ? onOpen : undefined}
              onPin={(g) => actions.pin(g.id, shelved(), g.name)}
              onBlock={(g) => actions.block(g.id, shelved(), g.name)} />
  );

  // Departed games hold their place until their animation is done, so the rows
  // below do not jump up under the pointer while a reader is still looking.
  const gone = [...(marks.left ?? new Map())]
    .filter(([, key]) => key === cell?.key)
    .map(([id]) => ix.rowOf.get(id))
    .filter((row) => row !== undefined);

  return (
    <div className={`${css.cell} ${full ? css.full : css.mini}`}
         onClick={onFocus && ((e) => {
           if (e.target.closest('button, [role="button"], summary, input, a')) return;
           onFocus();
         })}>
      <div className={css.head}>
        {/* In a grid the row and the column already say which shelf this is, so
            repeating it thirty-five times is noise rather than a label. The
            count carries the shelf's name for anyone who cannot see where it
            sits. */}
        {showName && (onFocus
          ? (
            <button type="button" className={css.name} onClick={onFocus}
                    aria-label={`Open ${name}`}>{name}</button>
          ) : <span className={css.name}>{name}</span>)}
        {full ? (
          <span className={css.depth}>
            {/* What it holds and what it is aiming for are two numbers, and
                they differ whenever the corpus cannot fill the shelf. */}
            <span className={css.count}>{held} games</span>
            <DepthField value={depthOf(built, cell)}
                        set={state.depthOverrides[depthKeyOf(cell, built.axes)] != null}
                        label="Games on this shelf"
                        onChange={(v) => actions.setDepth(depthKeyOf(cell, built.axes), v)}
                        onClear={() => actions.setDepth(depthKeyOf(cell, built.axes), null)} />
            <PlusMinus depthKey={depthKeyOf(cell, built.axes)} held={held} next={next}
                       actions={actions} />
          </span>
        ) : (
          <span className={css.tally}>
            <b className={css.count}>{held}</b>
            {/* One more, one fewer, without opening the shelf first.
                This is a reversal, and the measurement it reverses is worth
                keeping in view: a filled two-axis grid once carried 110
                controls, seventy of them this stepper repeated once per cell,
                and moving it into the opened shelf took that to 74. It is back
                on request. What makes it survivable now is that the cell is a
                single click target — the stepper is the only thing in a mini
                cell that takes a click of its own. If the grid starts to read
                as a toolbar again, this is the thing to take out. */}
            {cell && <PlusMinus depthKey={depthKeyOf(cell, built.axes)}
                                held={held} next={next} actions={actions} />}
            {/* A count that opens something is a count that looks like a count.
                The icon says there is somewhere to go. */}
            {onFocus && (
              <button type="button" className={css.open} onClick={onFocus}
                      aria-label={`Open ${name}`} title={`Open ${name}`}>
                <Expand />
              </button>
            )}
          </span>
        )}
      </div>

      {/* At full size the analyses sit beside the games rather than under them:
          a radar given a whole row of its own is mostly empty air, and the
          games are what a reader came for. One column again when there is not
          the width for two. */}
      <div className={full && analyses ? css.body : undefined}>
        {full && analyses && <div className={css.aside}>{analyses}</div>}
        <div className={css.picks}>
        {(cell?.picks ?? []).map((p) => item(
          ix.rowOf.get(p.id), p.id,
          marks.arrived?.has(p.id) ? 'came' : null))}
        {gone.map((row) => item(row, ix.ids[row], 'went'))}
        {/* Said even while the last games are still fading out: a shelf that
            holds nothing is empty now, and waiting for the animation to finish
            before admitting it reads as a hang. */}
        {!held && <span className={css.empty}>{empty(full)}</span>}
        </div>
      </div>

      {full && next > 0 && (
        <details className={css.deck}>
          <summary className={css.deckHead}>
            {next} on deck — the next in line, if you make room
          </summary>
          <div className={css.picks}>
            {cell.alternates.map((a) => {
              const row = ix.rowOf.get(a.id);
              return row === undefined ? null : item(row, a.id, null);
            })}
          </div>
        </details>
      )}
    </div>
  );
}
