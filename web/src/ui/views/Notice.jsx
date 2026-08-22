import css from './Notice.module.css';

/**
 * What just happened, and what is currently forbidden.
 *
 * Blocking a game re-runs the whole selection rather than patching the slot it
 * left — a game is shelved at most once, so removing one frees others it was
 * crowding out. That is more correct and completely invisible: the shelf simply
 * looks different. So the difference is computed and said out loud.
 */

export function Notice({ state, built, actions }) {
  const { notice } = state;
  if (!notice) return null;
  const { ix, grid } = built;
  const now = new Set(grid.flatMap((c) => c.picks.map((p) => p.id)));
  const was = new Set(notice.was);
  const came = [...now].filter((id) => !was.has(id));
  const went = [...was].filter((id) => !now.has(id) && id !== notice.id);
  const name = (id) => ix.names[ix.rowOf.get(id)] ?? `#${id}`;
  const list = (ids) => ids.slice(0, 3).map(name).join(', ')
    + (ids.length > 3 ? ` and ${ids.length - 3} more` : '');

  const said = {
    block: <>Blocked <b>{notice.name}</b>. It will not be offered again.</>,
    unblock: <>Unblocked <b>{notice.name}</b>.</>,
    pin: <>Pinned <b>{notice.name}</b>. It holds its place whatever else changes.</>,
    unpin: <>Unpinned <b>{notice.name}</b>.</>,
  }[notice.kind];

  return (
    <div className={css.strip}>
      <span className={css.said}>
        <span>{said}</span>
        {came.length > 0 && <span className={css.in}>In: {list(came)}</span>}
        {went.length > 0 && <span className={css.out}>Out: {list(went)}</span>}
        {!came.length && !went.length && notice.kind === 'block' && (
          <span>Nothing took its place — the shelf had no one else worth taking.</span>
        )}
        <button type="button" className={css.undo}
                onClick={() => (notice.kind.startsWith('un')
                  ? null
                  : (notice.kind === 'block'
                    ? actions.block(notice.id, [...now], notice.name)
                    : actions.pin(notice.id, [...now], notice.name)))}>
          Undo
        </button>
      </span>
      <button type="button" className={css.dismiss} onClick={actions.dismiss}
              aria-label="Dismiss">✕</button>
    </div>
  );
}

/** Every game currently out of the running, with a way back in. */
export function Blocked({ state, built, actions }) {
  if (!state.blocked.length) return null;
  const { ix, grid } = built;
  const shelved = grid.flatMap((c) => c.picks.map((p) => p.id));
  const name = (id) => ix.names[ix.rowOf.get(id)] ?? `#${id}`;
  return (
    <details className={css.blocked}>
      <summary className={css.summary}>
        {state.blocked.length} blocked
        <span className={css.caret} aria-hidden="true">▾</span>
      </summary>
      <div className={css.pop}>
        <span className={css.label}>Never offered</span>
        {state.blocked.map((id) => (
          <span key={id} className={css.line}>
            <span>{name(id)}</span>
            <button type="button" aria-label={`Unblock ${name(id)}`}
                    onClick={() => actions.block(id, shelved, name(id))}>✕</button>
          </span>
        ))}
        <button type="button" className={css.clear}
                onClick={() => state.blocked.forEach(
                  (id) => actions.block(id, shelved, name(id)))}>
          Allow them all again
        </button>
      </div>
    </details>
  );
}
