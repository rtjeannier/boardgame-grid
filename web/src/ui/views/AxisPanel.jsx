import Button from '../primitives/Button.jsx';
import { mergeLast, splitWidest, splitWidestBand } from '../axes.js';
import css from './AxisPanel.module.css';

/**
 * One axis, configured where it is being looked at.
 *
 * This used to be a settings page, which was the wrong place for it twice over:
 * the fields were not editable, and a reading like "Players · 3 stops at 11"
 * means nothing next to a list of every other axis. Here it sits directly above
 * the shelves it describes, and the depth each group reached is on the row for
 * that group rather than in a table of its own.
 */

function Reading({ read }) {
  if (!read) return null;
  const { depth, set, read: worked } = read;
  // No "read" / "set" label: a depth is one kind of number whoever arrived at
  // it. What is worth saying is what the curve would have said, and only when
  // that differs from what the group is doing.
  return (
    <span className={`${css.reading} ${set ? css.typed : ''}`.trim()}>
      <b>{depth} deep</b>
      {worked != null && worked !== depth && <span>reads {worked}</span>}
    </span>
  );
}

function Players({ built, state, actions }) {
  const columns = state.columns;
  const depths = built.depths?.columnDepth;
  const set = (i, key, value) => {
    const next = columns.map((c, j) => (i === j ? { ...c, [key]: value } : c));
    actions.setColumns(next);
  };
  const more = () => actions.setColumns(splitWidest(columns));
  const fewer = () => actions.setColumns(mergeLast(columns));

  return (
    <>
      <div className={css.block}>
        <h3 className={css.label}>Player groups</h3>
        <div className={css.tools}>
          <span className={css.count}>
            <button type="button" aria-label="Fewer groups" disabled={columns.length < 3}
                    onClick={fewer}>−</button>
            <span>{columns.length}</span>
            <button type="button" aria-label="More groups" onClick={more}>＋</button>
          </span>
          <span className={css.countLabel}>groups</span>
          <Button tone="quiet"
                  onClick={() => actions.setColumns(built.ix.defaults?.playerColumns
                    ?? state.columns)}>Back to the defaults</Button>
        </div>
        <div className={css.rows}>
          {columns.map((c, i) => (
            <div key={`${c.label}-${i}`} className={css.row}>
              <input className={css.groupName} value={c.label} aria-label="Group name"
                     onChange={(e) => set(i, 'label', e.target.value)} />
              <span className={css.edge}>
                <input className={css.num} value={c.lo} aria-label="From"
                       onChange={(e) => set(i, 'lo', Number(e.target.value) || 1)} />
                to
                <input className={css.num} value={c.hi ?? ''} aria-label="To"
                       placeholder="any"
                       onChange={(e) => set(i, 'hi', e.target.value === ''
                         ? null : Number(e.target.value))} />
              </span>
              <Reading read={depths?.get(c.label)} />
              <button type="button" className={css.x} aria-label={`Remove ${c.label}`}
                      disabled={columns.length < 2}
                      onClick={() => actions.setColumns(columns.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className={css.block}>
        <h3 className={css.label}>How deep each one goes</h3>
        <p className={css.note}>
          A group keeps taking games while the next one still adds at least{' '}
          {Math.round((built.ix.defaults?.autoDepthLeftover ?? 0.45) * 100)}% of what
          its first one added, and stops at the first that does not. Nine-plus
          takes one game on that rule; three players takes nine. Click any depth
          on the shelves below to set it yourself.
        </p>
        {columns.some((c) => c.hi === null && c.lo > 9) === false
          && columns.some((c) => /8\+/.test(c.label) && c.lo === 9) && (
          <div className={css.flag}>
            <b>Check</b>
            <span>
              A group labelled 8+ that starts at nine leaves eight-player games
              in the one below. Rename it or move the edge.
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function Weight({ built, state, actions }) {
  const { rows } = built;
  const depths = built.depths?.rowDepth;
  const edges = rows.slice(0, -1).map((r) => r.hi);
  return (
    <>
      <div className={css.block}>
        <h3 className={css.label}>Weight bands</h3>
        <div className={css.tools}>
          <span className={css.count}>
            <button type="button" aria-label="Fewer bands" disabled={state.rowCount <= 2}
                    onClick={() => actions.setRows(state.rowCount - 1)}>−</button>
            <span>{state.rowCount}</span>
            <button type="button" aria-label="More bands" disabled={state.rowCount >= 6}
                    onClick={() => actions.addRow(splitWidestBand(rows))}>＋</button>
          </span>
          <span className={css.countLabel}>bands</span>
          {state.rowEdges && (
            <Button tone="quiet" onClick={() => actions.setRows(state.rowCount)}>
              Back to quantiles
            </Button>
          )}
        </div>
        <div className={css.rows}>
          {rows.map((r, i) => (
            <div key={r.index} className={css.row}>
              <span className={css.name}>{r.name}</span>
              <span className={css.edge}>
                {r.lo.toFixed(2)} to
                {i === rows.length - 1 ? (
                  <span>{r.hi.toFixed(2)}</span>
                ) : (
                  <input className={css.num} defaultValue={r.hi.toFixed(2)}
                         aria-label={`Top of ${r.name}`}
                         onBlur={(e) => {
                           const v = Number(e.target.value);
                           if (Number.isFinite(v)) actions.setRowEdge(i, v, edges);
                         }} />
                )}
              </span>
              <Reading read={depths?.get(String(r.index))} />
              <span />
            </div>
          ))}
        </div>
      </div>
      <div className={css.block}>
        <h3 className={css.label}>Why these edges</h3>
        <p className={css.note}>
          {state.rowEdges
            ? 'You have moved an edge, so the bands no longer hold comparable numbers of games. That is a fair thing to want — it is only worth knowing you have done it.'
            : 'Quantiles of the corpus, so each band holds a comparable number of games — about 200 apiece. Move one and that stops being true.'}
        </p>
        <p className={css.note}>
          BGG publishes a mean weight, not a boundary, so a game near an edge
          belongs partly to both bands rather than being cut off at one.
        </p>
      </div>
    </>
  );
}

export default function AxisPanel({ which, built, state, actions }) {
  if (!which) return null;
  return (
    <div className={css.panel}>
      {which === 'players'
        ? <Players built={built} state={state} actions={actions} />
        : <Weight built={built} state={state} actions={actions} />}
    </div>
  );
}
