import { Block, Pin } from '../icons.jsx';
import css from './Actions.module.css';

/**
 * The two verbs, in this order, wherever a game appears.
 *
 * They are deliberately not four. The interface this replaces had "own", "lock",
 * "keep", "anchor" and "ban" scattered across five files with three meanings for
 * "keep"; a reader could not tell which of them changed the result.
 */
export default function Actions({ pinned, blocked, onPin, onBlock, name }) {
  return (
    <span className={css.acts}>
      <button type="button" onClick={onPin} aria-pressed={!!pinned}
              title={pinned ? 'Pinned' : 'Pin'}
              aria-label={`${pinned ? 'Unpin' : 'Pin'}${name ? ` ${name}` : ''}`}
              className={`${css.act} ${pinned ? css.on : ''}`.trim()}>
        <Pin filled={!!pinned} />
      </button>
      <button type="button" onClick={onBlock} aria-pressed={!!blocked}
              title={blocked ? 'Blocked' : 'Block'}
              aria-label={`${blocked ? 'Unblock' : 'Block'}${name ? ` ${name}` : ''}`}
              className={`${css.act} ${css.stop} ${blocked ? css.on : ''}`.trim()}>
        <Block />
      </button>
    </span>
  );
}
