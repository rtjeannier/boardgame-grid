import { useMemo } from 'react';
import { cellLabeller } from './labels.js';
import { splitWidest, splitWidestBand } from '../axes.js';
import { useChanges } from '../useChanges.js';
import Cell from './Cell.jsx';
import useMedia, { STACKED } from '../useMedia.js';
import css from './Board.module.css';

/**
 * The collection once it has been split, in one or two directions.
 *
 * Layout and nothing else. Every shelf on it is a `Cell` at `mini`, which is the
 * same component the unsplit screen renders at `full` — so a grid is not a
 * different way of showing a collection, it is the same one at a smaller size.
 *
 * Counted on the shipped corpus, a two-axis board carries 135 controls, seventy
 * of them the depth stepper once per cell. That stepper was moved into the
 * opened shelf once — which took the board to 65 — and put back on request. What
 * makes it bearable is that a game in a mini cell is not a click target, so a
 * cell is one target plus its stepper rather than six competing ones. If the
 * board starts reading as a toolbar again, the stepper is the thing to take out.
 */

/**
 * Every shelf, one per row, when a matrix will not fit.
 *
 * Reflow rather than shrink, which is the style guide's order: at 430px a
 * seven-column board gives each game name four characters, and four characters
 * of a title is not a smaller version of the title. Lookup survives because
 * each shelf still carries its own name — which is exactly the condition under
 * which the guide prefers reflowing to scrolling sideways.
 *
 * The axis controls come with it: dropping a band or a group is still one
 * control per band or group, and they belong on the thing they govern.
 */
function Stack({ built, state, actions, onOpen, marks }) {
  const { grid } = built;
  const label = cellLabeller(built);
  return (
    <div className={css.stack}>
      {grid.map((cell) => (
        <div key={cell.key}
             className={`${css.stacked} ${state.focus?.key === cell.key ? css.picked : ''}`.trim()}>
          <Cell cell={cell} built={built} state={state} actions={actions}
                size="mini" marks={marks} onOpen={onOpen}
                onFocus={() => actions.focusCell(cell.key)} />
        </div>
      ))}
      {!grid.length && <p className={css.none}>Nothing to show yet.</p>}
      <p className={css.note}>
        {grid.length} shelves, listed. {label(grid[0]?.key ?? '')} first — the
        grid is the same collection, drawn as a matrix when there is room for one.
      </p>
    </div>
  );
}

export default function Board({ built, state, actions, onOpen }) {
  const { grid, columns, rows, axes } = built;
  const focused = state.focus?.kind === 'cell' ? state.focus.key : null;
  const stacked = useMedia(STACKED);
  const byKey = new Map(grid.map((c) => [c.key, c]));
  // Where every game sits right now. The hook compares it against the last one
  // and reports the difference, which is the whole of "say what changed".
  const at = useMemo(
    () => new Map(grid.flatMap((c) => c.picks.map((p) => [p.id, c.key]))), [grid]);
  const marks = useChanges(at);
  const onlyPlayers = axes.length === 1 && axes[0] === 'players';

  // Below the width where a column can hold a name, the matrix becomes a list.
  if (stacked) {
    return <Stack built={built} state={state} actions={actions}
                  onOpen={onOpen} marks={marks} />;
  }

  if (axes.length === 1) {
    const keys = onlyPlayers
      ? columns.map((c) => ({ key: c.label, label: c.label }))
      : rows.map((r) => ({ key: String(r.index), label: r.name }));
    return (
      <div className={css.columns}
           style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr)) 38px` }}>
        {keys.map(({ key, label }) => {
          const cell = byKey.get(key);
          return (
            <div key={key}
                 className={`${css.column} ${focused === cell?.key ? css.picked : ''}`.trim()}>
              <div className={css.head}>
                <span className={css.headLine}>
                  <b>{label}</b>
                  <button type="button" className={css.drop}
                          aria-label={onlyPlayers
                            ? `Drop the ${label} column` : `Drop the ${label} band`}
                          disabled={keys.length < 3}
                          onClick={() => (onlyPlayers
                            ? actions.setColumns(columns.filter((x) => x.label !== key))
                            : actions.dropRow(Number(key),
                              rows.slice(0, -1).map((r) => r.hi)))}>✕</button>
                </span>
              </div>
              <Cell cell={cell} built={built} state={state} actions={actions}
                    size="mini" marks={marks} onOpen={onOpen} showName={false} dense
                    onFocus={cell && (() => actions.focusCell(cell.key))} />
            </div>
          );
        })}
        <div className={`${css.column} ${css.addStrip}`}>
          <button type="button" className={css.add}
                  aria-label={onlyPlayers ? 'Add a player group' : 'Add a weight band'}
                  title="Splits the widest in two"
                  disabled={!onlyPlayers && rows.length >= 6}
                  onClick={() => (onlyPlayers
                    ? actions.setColumns(splitWidest(columns))
                    : actions.addRow(splitWidestBand(rows)))}>＋</button>
        </div>
      </div>
    );
  }

  return (
    <div className={css.board}
         style={{ gridTemplateColumns:
           `146px repeat(${columns.length}, minmax(0, 1fr)) 38px` }}>
      {/* Empty on purpose. It used to explain how a shelf's depth resolves,
          which is a rule about controls that are no longer here. */}
      <div className={css.corner} />
      {columns.map((c) => (
        <div key={c.label} className={css.colhead}>
          <span className={css.headLine}>
            <b>{c.label}</b>
            <button type="button" className={css.drop} aria-label={`Drop the ${c.label} column`}
                    disabled={columns.length < 2}
                    onClick={() => actions.setColumns(
                      columns.filter((x) => x.label !== c.label))}>✕</button>
          </span>
        </div>
      ))}
      <div className={`${css.colhead} ${css.addStrip}`}>
        <button type="button" className={css.add} aria-label="Add a player group"
                title="Splits the widest group in two"
                onClick={() => actions.setColumns(splitWidest(columns))}>＋</button>
      </div>

      {[...rows].reverse().map((row) => (
        <Row key={row.index} row={row} built={built} state={state}
             actions={actions} onOpen={onOpen} byKey={byKey} marks={marks}
             focused={focused} />
      ))}

      <div className={`${css.rowhead} ${css.addStrip}`}>
        <button type="button" className={css.add} aria-label="Add a weight band"
                title="Splits the widest band in two"
                disabled={rows.length >= 6}
                onClick={() => actions.addRow(splitWidestBand(rows))}>＋</button>
      </div>
      {columns.map((c) => <div key={c.label} className={css.spacer} />)}
      <div className={css.spacer} />
    </div>
  );
}

function Row({ row, built, state, actions, onOpen, byKey, marks, focused }) {
  const { columns } = built;
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
      </div>
      {columns.map((c) => {
        const cell = byKey.get(`${c.label}|${row.index}`);
        return (
          <div key={c.label}
               className={`${css.cell} ${focused === cell?.key ? css.picked : ''}`.trim()}>
            <Cell cell={cell} built={built} state={state} actions={actions}
                  size="mini" marks={marks} onOpen={onOpen} showName={false} dense
                  onFocus={cell && (() => actions.focusCell(cell.key))} />
          </div>
        );
      })}
      <div className={css.spacer} />
    </>
  );
}
