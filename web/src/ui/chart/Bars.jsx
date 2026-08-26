import css from './Bars.module.css';

/**
 * One game's real axes, in order, longest first.
 *
 * This exists because a radar of one game is mostly empty: Ra loads on four of
 * the twelve spokes and sits at zero on the other eight. Its axes say far more
 * — auction/bidding 0.40, constrained bidding 0.26, mythology 0.14 — and a bar
 * chart has room to write them down.
 *
 * `max` is the scale. Pass it whenever the numbers already mean something on
 * their own: a game's loadings sum to 1, so scaling them to the longest bar
 * made every game's top axis full width and drew Wingspan — 0.145, 0.121,
 * 0.106, 0.102, 0.100, 0.099, a game that is a bit of everything — as a solid
 * block. Left null the scale is the row maximum, which compares bars to each
 * other and says nothing about their size.
 */
export default function Bars({ items, labelWidth = 148, max = null, percent = false }) {
  if (!items?.length) return null;
  const top = max ?? Math.max(...items.map((i) => i.value));
  if (!(top > 0)) return null;
  const say = (v) => (percent ? `${Math.round(v * 100)}%` : v.toFixed(2));
  return (
    <div className={css.wrap} style={{ '--label': `${labelWidth}px` }}>
      {items.map((item) => (
        <div key={item.label} className={`${css.row} ${item.mark ? css.mark : ''}`.trim()}>
          <span className={css.label}>{item.label}</span>
          <span className={css.track}>
            <span className={css.fill}
                  style={{ width: `${Math.round((item.value / top) * 100)}%` }} />
          </span>
          <span className={css.n}>{say(item.value)}</span>
        </div>
      ))}
    </div>
  );
}
