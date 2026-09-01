import css from './Bars.module.css';

/**
 * One game's real axes, in order, longest first.
 *
 * This exists because a radar of one game is mostly empty: Ra loads on four of
 * the twelve spokes and sits at zero on the other eight. Its axes say far more
 * — auction/bidding 0.40, constrained bidding 0.26, mythology 0.14 — and a bar
 * chart has room to write them down.
 *
 * **A percentage is drawn against 100%, and nothing else.** It is already a
 * share of something, so the bar has a length before anybody chooses a scale:
 * 7% is a bar 7% of the way across a fixed track. Scaling a percentage to the
 * longest bar in its own list drew 7% at full width and 3% at half of it, which
 * says the top row is the whole of something and the bottom row is half of it —
 * neither is true, and the number printed beside it disagreed with the bar.
 *
 * `max` is the scale for everything else. Pass it whenever the numbers already
 * mean something on their own: a game's loadings sum to 1, so scaling them to
 * the longest bar made every game's top axis full width and drew Wingspan —
 * 0.145, 0.121, 0.106, 0.102, 0.100, 0.099, a game that is a bit of everything
 * — as a solid block. Left null, and not a percentage, the scale is the row
 * maximum, which compares bars to each other and says nothing about their size.
 */
export default function Bars({
  items, labelWidth = 148, max = null, percent = false, onPick = null,
}) {
  if (!items?.length) return null;
  const top = percent ? 1 : (max ?? Math.max(...items.map((i) => i.value)));
  // Nothing to draw is still nothing to draw — but with a fixed scale that can
  // no longer be read off `top`, which is now always 1 for a percentage.
  if (!(top > 0) || !items.some((i) => i.value > 0)) return null;
  const say = (v) => (percent ? `${Math.round(v * 100)}%` : v.toFixed(2));
  return (
    <div className={css.wrap} style={{ '--label': `${labelWidth}px` }}>
      {items.map((item) => (
        <div key={item.label} className={`${css.row} ${item.mark ? css.mark : ''}`.trim()}>
          {/* A label can be the way in to what it names. The bar stays the
              quantity — this is a chart affordance, not a fifth way to draw a
              game. */}
          {onPick
            ? (
              <button type="button" className={`${css.label} ${css.pick}`}
                      onClick={() => onPick(item)}>{item.label}</button>
            )
            : <span className={css.label}>{item.label}</span>}
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
