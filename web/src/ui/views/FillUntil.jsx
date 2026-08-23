import css from './FillUntil.module.css';

/**
 * What stops the fill.
 *
 * Depth, a budget and shelf volume are the same kind of thing — a limit on how
 * much gets filled — in different units, so they are one control rather than
 * three features. The engine takes a global `budget` and a per-game `costOf`;
 * with every game costing one game, a budget is a number of games, and the day
 * a price or a box size exists it is the same control with a different cost.
 *
 * The two that cannot work yet are shown rather than hidden, with the reason,
 * because the reason is a fact about the data that a reader should have.
 */
const RULES = [
  { key: 'returns', label: 'a game stops paying',
    detail: 'each shelf reads its own curve' },
  { key: 'count', label: 'a number of games', unit: 'games' },
  { key: 'budget', label: 'a budget', why: 'BGG publishes no price' },
  { key: 'volume', label: 'shelf space', why: 'BGG publishes no box size' },
];

export default function FillUntil({ fill, onChange, leftover }) {
  const current = RULES.find((r) => r.key === fill.rule) ?? RULES[0];
  const summary = fill.rule === 'count'
    ? `${fill.count} games`
    : `${current.label} · ${Math.round((leftover ?? 0.45) * 100)}%`;

  return (
    <details className={css.wrap}>
      <summary className={css.summary}>
        <span className={css.label}>Fill until</span>
        {summary}
        <span className={css.caret} aria-hidden="true">▾</span>
      </summary>
      <div className={css.pop}>
        {RULES.map((rule) => {
          const on = rule.key === fill.rule;
          return (
            <div key={rule.key}>
              <button type="button" disabled={!!rule.why}
                      className={`${css.option} ${on ? css.on : ''}`.trim()}
                      aria-pressed={on}
                      onClick={() => onChange({ rule: rule.key })}>
                <span className={css.dot} />
                <span>{rule.label}</span>
                <span className={css.why}>{rule.why ?? rule.detail ?? ''}</span>
              </button>
              {on && rule.unit && (
                <div className={css.value}>
                  <input className={css.num} type="text" inputMode="numeric"
                         aria-label="How many games" value={fill.count}
                         onChange={(e) => {
                           const n = parseInt(e.target.value, 10);
                           onChange({ count: Number.isNaN(n) ? 0 : Math.max(0, n) });
                         }} />
                  <span className={css.unit}>{rule.unit}</span>
                </div>
              )}
            </div>
          );
        })}
        <p className={css.foot}>
          A limit on the whole collection, on top of how deep each shelf goes —
          both are ceilings and the smaller wins.
        </p>
      </div>
    </details>
  );
}
