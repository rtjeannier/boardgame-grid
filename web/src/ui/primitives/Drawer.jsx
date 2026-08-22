import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Close } from '../icons.jsx';
import css from './Drawer.module.css';

/**
 * A panel over the page, with the two things the last one was missing: a scrim
 * that closes it, and a scroll lock so the grid stays put underneath. Escape
 * closes it too.
 */
export default function Drawer({ open, onClose, head, children }) {
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
  // stacking context can clip it — the settings panel used to cover the drawer.
  const target = typeof document === 'undefined' ? null : document.body;
  const content = (
    <>
      <button className={css.scrim} aria-label="Close" onClick={onClose} />
      <aside className={css.panel} role="dialog" aria-modal="true">
        <header className={css.head}>
          <div className={css.headMain}>{head}</div>
          <button type="button" className={css.close} onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className={css.body}>{children}</div>
      </aside>
    </>
  );
  return target ? createPortal(content, target) : content;
}
