import css from './Split.module.css';

/**
 * How the collection is cut, and the only control that stays above the result.
 *
 * With nothing on, the collection is one cell holding the whole game space —
 * which is what `build_cells(games, axes=[])` returns, so this is not a view
 * mode but the axis list itself. One on gives columns, two gives a grid.
 */
export function SplitBar({
  axes, active, onToggle, onOpen, openKey, count, onlyMine, ownedCount = 0, children,
}) {
  return (
    <div className={css.bar}>
      <span className={css.label}>Split by</span>
      {axes.map((axis) => {
        const on = active.includes(axis.key);
        // Off, the chip turns the axis on. On, the body opens the axis's own
        // settings — where the groups and the depths it read are — and the ✕
        // turns it off again. Two things, so two hit areas.
        if (!on) {
          return (
            <button key={axis.key} type="button" className={css.chip}
                    aria-pressed={false} onClick={() => onToggle(axis.key)}>
              {`＋ ${axis.label}`}
            </button>
          );
        }
        return (
          <span key={axis.key}
                className={`${css.chip} ${css.on} ${openKey === axis.key ? css.open : ''}`.trim()}>
            <button type="button" className={css.body} aria-pressed
                    aria-expanded={openKey === axis.key}
                    onClick={() => onOpen?.(axis.key)}>
              {axis.label}
              <span className={css.gear} aria-hidden="true">
                {openKey === axis.key ? '▴' : '▾'}
              </span>
            </button>
            <button type="button" className={css.mark}
                    aria-label={`Stop splitting by ${axis.label}`}
                    onClick={() => onToggle(axis.key)}>✕</button>
          </span>
        );
      })}
      <span className={css.right}>
        {onlyMine && (
          <button type="button" disabled={!ownedCount}
                  className={`${css.only} ${onlyMine.on ? css.onlyOn : ''}`.trim()}
                  aria-pressed={!!onlyMine.on} onClick={onlyMine.toggle}
                  title={ownedCount
                    ? 'Hold every game you own and fill the rest around them'
                    : 'Add some of your games first'}>
            Build on mine
          </button>
        )}
        {count != null && <span className={css.count}>{`${count} games`}</span>}
        {children}
      </span>
    </div>
  );
}

export default SplitBar;
