import css from './Bars.module.css';

/**
 * One game's real axes, in order, longest first.
 *
 * This exists because a radar of one game is mostly empty: Ra loads on four of
 * the twelve spokes and sits at zero on the other eight. Its axes say far more
 * — auction/bidding 0.40, constrained bidding 0.26, mythology 0.14 — and a bar
 * chart has room to write them down.
 */
export default function Bars({ items, labelWidth = 148, max = null }) {
  if (!items?.length) return null;
  const top = max ?? Math.max(...items.map((i) => i.value));
  if (!(top > 0)) return null;
  return (
    <div className={css.wrap} style={{ '--label': `${labelWidth}px` }}>
      {items.map((item) => (
        <div key={item.label} className={css.row}>
          <span className={css.label}>{item.label}</span>
          <span className={css.track}>
            <span className={css.fill}
                  style={{ width: `${Math.round((item.value / top) * 100)}%` }} />
          </span>
          <span className={css.n}>{item.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
