import css from './FillUntil.module.css';

/**
 * What stops the fill — a list of limits, not a choice between them.
 *
 * Depth, a budget and shelf volume are the same kind of thing, so they are one
 * control; but they are not alternatives, and a shelf's limit is not the
 * collection's. Each row is on or off and says whether it binds one shelf or the
 * whole collection, and every one that is on applies with the smallest winning —
 * the rule a column's depth and a row's already meet under.
 *
 * The engine takes a global `budget` and a per-game `costOf`; with every game
 * costing one game a budget is a number of games, and the day a price or a box
 * size exists it is this same list with a different cost. The two that cannot
 * work yet are shown with the reason rather than hidden, because the reason is a
 * fact about the data a reader should have.
 */
const KINDS = {
  returns: { label: 'a game stops paying', unit: '% of its first pick',
             fixed: 'each shelf reads its own curve' },
  count: { label: 'a number of games', unit: 'games' },
  budget: { label: 'a budget', why: 'BGG publishes no price' },
  volume: { label: 'shelf space', why: 'BGG publishes no box size' },
};
const SCOPE = { shelf: 'a shelf', total: 'in total' };

function summarise(limits, leftover) {
  const on = limits.filter((l) => l.on);
  if (!on.length) return 'nothing stops it';
  return on.map((l) => (l.kind === 'returns'
    ? `under ${l.value ?? Math.round((leftover ?? 0.45) * 100)}% returns`
    : `${l.value} games ${SCOPE[l.scope]}`))
    .join(' · ');
}

export default function FillUntil({ limits, onChange, leftover }) {
  return (
    <details className={css.wrap}>
      <summary className={css.summary}>
        <span className={css.label}>Fill until</span>
        {summarise(limits, leftover)}
        <span className={css.caret} aria-hidden="true">▾</span>
      </summary>
      <div className={css.pop}>
        {limits.map((limit, at) => {
          const kind = KINDS[limit.kind];
          const blocked = !!kind.why;
          return (
            <div key={`${limit.kind}-${limit.scope}`} className={css.row}>
              <label className={`${css.option} ${blocked ? css.blocked : ''}`.trim()}>
                <input type="checkbox" className={css.check} checked={limit.on}
                       disabled={blocked}
                       onChange={() => onChange(at, { on: !limit.on })} />
                <span className={css.name}>{kind.label}</span>
                <span className={css.scope}>
                  {kind.fixed ?? (blocked ? kind.why : SCOPE[limit.scope])}
                </span>
              </label>
              {limit.on && !blocked && limit.value != null && (
                <span className={css.value}>
                  <input className={css.num} type="text" inputMode="numeric"
                         aria-label={`${kind.label}, ${SCOPE[limit.scope]}`}
                         value={limit.value}
                         onChange={(e) => {
                           const n = parseInt(e.target.value, 10);
                           onChange(at, { value: Number.isNaN(n) ? 0 : Math.max(0, n) });
                         }} />
                  <span className={css.unit}>{kind.unit}</span>
                </span>
              )}
            </div>
          );
        })}
        <p className={css.foot}>
          Everything ticked applies at once and the smallest wins. Turn the first
          one off and a shelf stops reading its own curve — it takes the number
          you set and nothing recomputes behind you.
        </p>
      </div>
    </details>
  );
}
