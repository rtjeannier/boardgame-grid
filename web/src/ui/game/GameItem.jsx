import Actions from './Actions.jsx';
import css from './GameItem.module.css';

/** The variants there are. Named rather than looked up, so a typo is a
    missing class at the call site instead of an unstyled row. */
const VARIANT = {
  compact: css.compact, row: css.row, reason: css.reason, expanded: css.expanded,
};

/**
 * A game, drawn four ways from one view model.
 *
 * `compact` is a line on a shelf, `row` is the register workhorse, `reason` is a
 * row that has to explain itself, `expanded` is the header of a detail view.
 * They differ in what they show and never in what they mean: the same two verbs
 * in the same order, the same rank format, the same shelf naming.
 */
export default function GameItem({
  game, variant = 'row', onPin, onBlock, onOpen, actions = true,
}) {
  if (!game) return null;
  const classes = [css.item, VARIANT[variant] ?? VARIANT.row];
  if (game.owned) classes.push(css.mine);
  if (game.pinned || game.blocked) classes.push(css.marked);
  if (game.blocked) classes.push(css.blocked);

  const verbs = actions ? (
    <Actions name={game.name} pinned={game.pinned} blocked={game.blocked}
             onPin={() => onPin?.(game)} onBlock={() => onBlock?.(game)} />
  ) : null;

  const open = onOpen ? { onClick: () => onOpen(game), role: 'button', tabIndex: 0 } : {};

  if (variant === 'compact') {
    // The verbs are there but out of the way: a shelf of five names with ten
    // buttons beside them is a toolbar, not a shelf. They appear on hover and
    // on keyboard focus, and take the space the rank was using.
    return (
      <div className={classes.join(' ')}>
        <span className={css.main} {...open}>
          <span className={css.name}>{game.name}</span>
        </span>
        <span className={css.rankSlot}>{game.rankLabel}</span>
        {verbs && <span className={css.hoverSlot}>{verbs}</span>}
      </div>
    );
  }

  if (variant === 'expanded') {
    return (
      <div className={classes.join(' ')}>
        <span className={css.main}>
          <span className={css.name}>{game.name} <span className={css.meta}>{game.rankLabel}</span></span>
          <span className={css.meta}>{game.tags}</span>
          <span className={css.facts}>
            {game.players && <span className={css.fact}><b>{game.players}</b><span>best at</span></span>}
            <span className={css.fact}><b>{game.timeLabel}</b><span>length</span></span>
            <span className={css.fact}><b>{game.weight}</b><span>weight</span></span>
            {game.year ? <span className={css.fact}><b>{game.year}</b><span>published</span></span> : null}
          </span>
          {verbs && <span style={{ marginTop: 'var(--s-6)' }}>{verbs}</span>}
        </span>
      </div>
    );
  }

  if (variant === 'reason') {
    return (
      <div className={classes.join(' ')}>
        <span className={css.main} {...open}>
          <span className={css.name}>{game.name} <span className={css.meta}>{game.rankLabel}</span></span>
          {game.reason && <span className={css.why}>{game.reason}</span>}
        </span>
        {verbs}
      </div>
    );
  }

  return (
    <div className={classes.join(' ')}>
      <span className={css.main} {...open}>
        <span className={css.name}>{game.name}</span>
        <span className={css.meta}>
          {[game.players, game.weight, game.timeLabel].filter(Boolean).join(' · ')}
        </span>
      </span>
      {game.carries == null ? <span /> : (
        <span className={css.carries}>
          <span className={css.bar}>
            <span className={css.fill}
                  style={{ width: `${Math.min(100, Math.round(game.carries * 1000))}%`,
                           opacity: (0.35 + Math.min(1, game.carries * 10) * 0.65).toFixed(2) }} />
          </span>
          <span className={css.n}>{game.carriesLabel}</span>
        </span>
      )}
      {verbs}
    </div>
  );
}
