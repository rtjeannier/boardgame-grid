import css from './DepthField.module.css';

/**
 * How deep a shelf goes: a number you click into and type.
 *
 * Not a pair of arrows. The value is usually worked out rather than chosen, so
 * the field says which — `auto`, or `set` once you have typed over it. It does
 * not keep reciting the number you replaced.
 */
export default function DepthField({ value, auto, onChange, id }) {
  const overridden = auto != null && value !== auto;
  return (
    <span className={`${css.wrap} ${overridden ? css.set : ''}`.trim()}>
      <input className={css.n} id={id} type="text" inputMode="numeric"
             value={value} aria-label="Games on this shelf"
             onChange={(e) => {
               const next = parseInt(e.target.value, 10);
               if (!Number.isNaN(next)) onChange?.(Math.max(0, next));
               else if (e.target.value === '') onChange?.(0);
             }} />
      <span className={css.tag}>{overridden ? 'set' : 'auto'}</span>
    </span>
  );
}
