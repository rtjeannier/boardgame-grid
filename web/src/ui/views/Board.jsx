import DepthField from '../primitives/DepthField.jsx';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import css from './Board.module.css';

/**
 * The collection once it has been split, in one or two directions.
 *
 * Depth belongs on the header of the thing it governs, which is why there is no
 * control anywhere else for it. It is a number you click into and type: the
 * arrows this replaces implied stepping through values one at a time, when the
 * usual move is to disagree with the reading outright.
 */

/** Everything shelved right now, so the next build can be compared against it. */
export const shelvedNow = (built) =>
  built.grid.flatMap((c) => c.picks.map((p) => p.id));

/** An empty shelf means two different things, so it says which. */
const empty = (state) =>
  (state.mineOnly ? 'nothing of yours' : 'nothing reaches here');

const line = (built, game, state) => toGameView(built.ix, game, {
  owned: state.owned.includes(built.ix.ids[game]),
  pinned: state.pinned.includes(built.ix.ids[game]),
  blocked: state.blocked.includes(built.ix.ids[game]),
});

function Depth({ kind, label, read, actions }) {
  if (!read) return null;
  return (
    <DepthField value={read.depth} auto={read.read ?? (read.auto ? read.depth : null)}
                onChange={(v) => actions.setDepth(`${kind}:${label}`, v)} />
  );
}

/**
 * What did not quite make the shelf.
 *
 * Kept out of the way until asked for, because a shelf of five with six
 * runners-up under it is a list of eleven. Pinning one puts it on: the same verb
 * as everywhere else, doing the obvious thing.
 */
function OnDeck({ cell, built, state, actions, onOpen }) {
  const next = cell?.alternates ?? [];
  const held = cell?.picks?.length ?? 0;
  const set = (n) => actions.setDepth(`cell:${cell.key}`, Math.max(0, n));
  if (!cell) return null;
  return (
    <details className={css.deck}>
      <summary className={css.deckHead}>
        {next.length ? `${next.length} on deck` : 'nothing else reaches here'}
        {/* One shelf's depth, set on that shelf. Grey until the pointer is in
            the cell, because thirty-five of these would otherwise be the only
            thing on the screen. */}
        <span className={css.pm} onClick={(e) => e.preventDefault()}>
          <button type="button" aria-label="One fewer here" disabled={held === 0}
                  onClick={() => set(held - 1)}>−</button>
          <b>{held}</b>
          <button type="button" aria-label="One more here" disabled={!next.length}
                  onClick={() => set(held + 1)}>＋</button>
        </span>
      </summary>
      {next.map((a) => {
        const row = built.ix.rowOf.get(a.id);
        if (row === undefined) return null;
        return (
          <GameItem key={a.id} variant="compact"
                    game={line(built, row, state)} onOpen={onOpen}
                    onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                    onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
        );
      })}
    </details>
  );
}

export default function Board({ built, state, actions, onOpen }) {
  const { ix, grid, depths, columns, rows, axes } = built;
  const byKey = new Map(grid.map((c) => [c.key, c]));
  const onlyPlayers = axes.length === 1 && axes[0] === 'players';

  if (axes.length === 1) {
    const keys = onlyPlayers
      ? columns.map((c) => ({ key: c.label, label: c.label }))
      : rows.map((r) => ({ key: String(r.index), label: r.name }));
    const depthMap = onlyPlayers ? depths?.columnDepth : depths?.rowDepth;
    return (
      <div className={css.columns}
           style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
        {keys.map(({ key, label }) => {
          const cell = byKey.get(key);
          return (
            <div key={key} className={css.column}>
              <div className={css.head}>
                <b>{label}</b>
                <div style={{ marginTop: 'var(--s-3)' }}>
                  <Depth kind={onlyPlayers ? 'column' : 'row'} label={key}
                         read={depthMap?.get(key)} actions={actions} />
                </div>
                {cell?.alternates?.[0] && (
                  <div className={css.next}>next: {cell.alternates[0].name}</div>
                )}
              </div>
              <div className={css.picks}>
                {(cell?.picks ?? []).map((p) => (
                  <GameItem key={p.id} variant="compact"
                            game={line(built, ix.rowOf.get(p.id), state)}
                            onOpen={onOpen}
                            onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                            onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
                ))}
                {!cell?.picks?.length && (
                  <span className={css.empty}>{empty(state)}</span>
                )}
                <OnDeck cell={cell} built={built} state={state}
                        actions={actions} onOpen={onOpen} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={css.board}
         style={{ gridTemplateColumns: `146px repeat(${columns.length}, minmax(0, 1fr))` }}>
      <div className={css.corner}>
        <b>Games per shelf</b>
        <span>Read down each column and across each row. A shelf takes the smaller.</span>
      </div>
      {columns.map((c) => (
        <div key={c.label} className={css.colhead}>
          <span className={css.headLine}>
            <b>{c.label}</b>
            <button type="button" className={css.drop} aria-label={`Drop the ${c.label} column`}
                    disabled={columns.length < 2}
                    onClick={() => actions.setColumns(
                      columns.filter((x) => x.label !== c.label))}>✕</button>
          </span>
          <div style={{ marginTop: 'var(--s-3)' }}>
            <Depth kind="column" label={c.label}
                   read={depths?.columnDepth?.get(c.label)} actions={actions} />
          </div>
        </div>
      ))}
      {[...rows].reverse().map((row) => (
        <Row key={row.index} row={row} built={built} state={state}
             actions={actions} onOpen={onOpen} byKey={byKey} />
      ))}
    </div>
  );
}

function Row({ row, built, state, actions, onOpen, byKey }) {
  const { ix, columns, depths } = built;
  return (
    <>
      <div className={css.rowhead}>
        <span className={css.headLine}>
          <b>{row.name}</b>
          <button type="button" className={css.drop} aria-label={`Drop the ${row.name} band`}
                  disabled={built.rows.length < 3}
                  onClick={() => actions.dropRow(
                    row.index, built.rows.slice(0, -1).map((r) => r.hi))}>✕</button>
        </span>
        <span className={css.range}>{row.lo.toFixed(2)}–{row.hi.toFixed(2)}</span>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Depth kind="row" label={String(row.index)}
                 read={depths?.rowDepth?.get(String(row.index))} actions={actions} />
        </div>
      </div>
      {columns.map((c) => {
        const cell = byKey.get(`${c.label}|${row.index}`);
        return (
          <div key={c.label} className={css.cell}>
            {(cell?.picks ?? []).map((p) => (
              <GameItem key={p.id} variant="compact"
                        game={line(built, ix.rowOf.get(p.id), state)} onOpen={onOpen}
                        onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                        onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
            ))}
            {!cell?.picks?.length && <span className={css.empty}>{empty(state)}</span>}
            <OnDeck cell={cell} built={built} state={state}
                    actions={actions} onOpen={onOpen} />
          </div>
        );
      })}
    </>
  );
}
