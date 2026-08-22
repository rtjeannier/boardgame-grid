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
                  <GameItem key={p.id} variant="compact" actions={false}
                            game={line(built, ix.rowOf.get(p.id), state)}
                            onOpen={onOpen} />
                ))}
                {!cell?.picks?.length && <span className={css.empty}>nothing reaches here</span>}
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
          <b>{c.label}</b>
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
        <b>{row.name}</b>
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
              <GameItem key={p.id} variant="compact" actions={false}
                        game={line(built, ix.rowOf.get(p.id), state)} onOpen={onOpen} />
            ))}
            {!cell?.picks?.length && <span className={css.empty}>—</span>}
          </div>
        );
      })}
    </>
  );
}
