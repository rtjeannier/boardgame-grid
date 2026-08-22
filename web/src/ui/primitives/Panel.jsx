import css from './Panel.module.css';

/** A titled surface that owns its own padding, so callers never add margins. */
export default function Panel({ title, blurb, aside, children }) {
  return (
    <section className={css.panel}>
      {(title || aside) && (
        <div className={css.head}>
          {title && <h2 className={css.title}>{title}</h2>}
          {aside && <span className={css.aside}>{aside}</span>}
        </div>
      )}
      {blurb && <p className={css.blurb}>{blurb}</p>}
      {children}
    </section>
  );
}
