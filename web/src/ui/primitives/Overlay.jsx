import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Close } from '../icons.jsx';
import css from './Overlay.module.css';

/**
 * One surface, and the thing you clicked is its subject.
 *
 * Not a drawer and not a stack. A shelf opens here, a game opens here, and the
 * collection opens here — never two of them at once, which is the style guide's
 * "avoid nested panels" taken literally. It replaces a panel that slid in from
 * the right and covered the grid it was launched from.
 *
 * `onBack` is given only when there is somewhere to go back to, which is the one
 * case a second panel would otherwise have been for: a game opened from a shelf.
 */
export default function Overlay({ open, onClose, onBack, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  // Rendered outside the view that opened it, so no ancestor's overflow or
  // stacking context can clip it.
  const target = typeof document === 'undefined' ? null : document.body;
  const content = (
    <>
      <button className={css.scrim} aria-label="Close" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={title}>
        <header className={css.head}>
          {onBack && (
            <button type="button" className={css.back} onClick={onBack}>‹ back</button>
          )}
          <button type="button" className={css.close} onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className={css.body}>{children}</div>
      </div>
    </>
  );
  return target ? createPortal(content, target) : content;
}
