import Button from '../primitives/Button.jsx';
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
  const { depth, auto, read: worked } = read;
  return (
    <span className={`${css.reading} ${auto ? '' : css.fellBack}`.trim()}>
      <b>{depth} deep</b>
      <span>{auto ? 'read' : `set${worked == null ? '' : ` · reads ${worked}`}`}</span>
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
  /**
   * One more group splits the widest one in two; one fewer merges the last two.
   *
   * Both keep the ranges contiguous, which editing them by hand does not — the
   * fields below let you make a gap, and that is your business, but the stepper
   * should never make one for you.
   */
  const relabel = (lo, hi) => (hi == null ? `${lo}+` : lo === hi ? `${lo}` : `${lo}-${hi}`);
  const more = () => {
    let widest = -1, at = -1;
    columns.forEach((c, i) => {
      const span = c.hi == null ? Infinity : c.hi - c.lo;
      if (span > widest && span >= 1) { widest = span; at = i; }
    });
    if (at < 0) {                       // every group is a single count already
      const last = columns[columns.length - 1];
      const from = (last.hi ?? last.lo) + 1;
      actions.setColumns([...columns, { label: `${from}+`, lo: from, hi: null }]);
      return;
    }
    const c = columns[at];
    const mid = c.hi == null ? c.lo : Math.floor((c.lo + c.hi) / 2);
    actions.setColumns([
      ...columns.slice(0, at),
      { lo: c.lo, hi: mid, label: relabel(c.lo, mid) },
      { lo: mid + 1, hi: c.hi, label: relabel(mid + 1, c.hi) },
      ...columns.slice(at + 1),
    ]);
  };
  const fewer = () => {
    if (columns.length < 3) return;
    const a = columns[columns.length - 2];
    const b = columns[columns.length - 1];
    actions.setColumns([
      ...columns.slice(0, -2),
      { lo: a.lo, hi: b.hi, label: relabel(a.lo, b.hi) },
    ]);
  };
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
              <input className={css.num} value={c.label} aria-label="Group name"
                     style={{ textAlign: 'left', width: '100%' }}
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
                    onClick={() => actions.setRows(state.rowCount + 1)}>＋</button>
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
