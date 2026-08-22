import css from './Split.module.css';

/**
 * How the collection is cut, and the only control that stays above the result.
 *
 * With nothing on, the collection is one cell holding the whole game space —
 * which is what `build_cells(games, axes=[])` returns, so this is not a view
 * mode but the axis list itself. One on gives columns, two gives a grid.
 */
export function SplitBar({ axes, active, onToggle, count, children }) {
  return (
    <div className={css.bar}>
      <span className={css.label}>Split by</span>
      {axes.map((axis) => {
        const on = active.includes(axis.key);
        return (
          <button key={axis.key} type="button"
                  className={`${css.chip} ${on ? css.on : ''}`.trim()}
                  aria-pressed={on} onClick={() => onToggle(axis.key)}>
            {on ? axis.label : `＋ ${axis.label}`}
            {on && <span className={css.mark} aria-hidden="true">✕</span>}
          </button>
        );
      })}
      <span className={css.right}>
        {count != null && <span className={css.count}>{`${count} games`}</span>}
        {children}
      </span>
    </div>
  );
}

export default SplitBar;
