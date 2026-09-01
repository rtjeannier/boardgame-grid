import Actions from './Actions.jsx';
import css from './GameItem.module.css';

/** The variants there are. Named rather than looked up, so a typo is a
    missing class at the call site instead of an unstyled row. */
const VARIANT = {
  compact: css.compact, row: css.row, reason: css.reason,
};

/**
 * A game, drawn four ways from one view model.
 *
 * `compact` is a line on a shelf, `row` is the register workhorse, `reason` is a
 * row that has to explain itself. They differ in what they show and never in
 * what they mean: the same two verbs in the same order, the same rank format,
 * the same shelf naming.
 *
 * There was a fourth, `expanded`, meant as the header of a detail view. Nothing
 * ever rendered it — `views/Game.jsx` is that detail view and builds its own
 * header, because it needs labelled verbs including "I own this" where these
 * rows carry two icons. A variant only its own test reaches is not a variant.
 */
/** The two things that can just have happened to a row. */
const CHANGE = { came: css.came, went: css.went };

export default function GameItem({
  game, variant = 'row', onPin, onBlock, onOpen, actions = true, change = null,
  showRank = true,
}) {
  if (!game) return null;
  const classes = [css.item, VARIANT[variant] ?? VARIANT.row];
  // Arriving and leaving are *states* of a row, not new kinds of row, so they
  // add a class and never a variant. Colour is allowed to carry them because a
  // state is what colour is for here — and deliberately not the accent, which
  // means "this is yours" and nothing else.
  // Named rather than looked up by key, so the two states are a closed set and
  // the stylesheet check can see that both are used.
  if (change) classes.push(CHANGE[change]);
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
        {/* In a grid column the rank costs 26px of a 143px cell — a fifth of it
            — for a number that is on the shelf you open and in the game itself.
            The name gets it back. */}
        {showRank && <span className={css.rankSlot}>{game.rankLabel}</span>}
        {verbs && <span className={css.hoverSlot}>{verbs}</span>}
      </div>
    );
  }

  if (variant === 'reason') {
    return (
      <div className={classes.join(' ')}>
        <span className={css.main} {...open}>
          <span className={css.name}>
            {game.name} <span className={css.meta}>{game.rankLabel}</span>
          </span>
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
      {verbs}
    </div>
  );
}
