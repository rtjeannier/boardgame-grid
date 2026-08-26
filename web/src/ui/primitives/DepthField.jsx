import css from './DepthField.module.css';

/**
 * How deep a shelf goes: a number you click into and type.
 *
 * Not a pair of arrows. The value is usually worked out rather than chosen, but
 * it does not say so: the `auto` / `set` tag this used to carry announced two
 * kinds of number where a reader only ever sees one, and reading "auto" next to
 * a figure you had just typed over was the single most confusing thing on the
 * screen. What is worth offering is the way back, and only once there is
 * something to go back to.
 */
export default function DepthField({ value, set, onChange, onClear, id, label }) {
  return (
    <span className={`${css.wrap} ${set ? css.set : ''}`.trim()}>
      <input className={css.n} id={id} type="text" inputMode="numeric"
             value={value} aria-label={label ?? 'Games on this shelf'}
             onChange={(e) => {
               const next = parseInt(e.target.value, 10);
               if (!Number.isNaN(next)) onChange?.(Math.max(0, next));
               else if (e.target.value === '') onChange?.(0);
             }} />
      {set && onClear && (
        <button type="button" className={css.revert}
                aria-label="Back to what the shelf reads"
                title="Back to what the shelf reads"
                onClick={onClear}>↺</button>
      )}
    </span>
  );
}
