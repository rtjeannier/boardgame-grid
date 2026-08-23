import { redundancies } from '../../engine/index.js';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import { shelvedNow } from '../views/Board.jsx';
import { register } from './registry.js';
import css from './analysis.module.css';

/**
 * Games the collection is holding twice.
 *
 * Nothing is proposed to take a place. The runner-up is the game the selection
 * already turned down, and putting it in makes the shelf worse — measured, one
 * shelf went 0.372 to 0.141 and the collection 11.982 to 11.980. The redundancy
 * is reported; the decision is the reader's.
 */
export default register({
  id: 'held-twice',
  scope: 'collection',
  run({ built, state }) {
    const { ix, weights, grid } = built;
    const floor = ix.defaults?.redundancyFloor ?? 0.9;
    const picked = state.selected ? grid.find((c) => c.key === state.selected) : null;
    const from = picked ? [picked] : grid;
    const rows = from.flatMap((c) => c.picks.map((p) => ix.rowOf.get(p.id)))
      .filter((r) => r !== undefined);
    if (rows.length < 2) return null;

    const found = redundancies(ix, weights, rows, { floor })
      .map((r) => ({ ...r, mine: state.owned.includes(r.id) }))
      .sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
    return found.length ? { found, picked: !!picked } : null;
  },
  View({ data, built, state, actions, onOpen }) {
    const { ix } = built;
    return (
      <div className={css.block}>
        <h2 className={css.label}>
          {data.picked ? 'Held twice on this shelf' : 'Held twice'}
        </h2>
        <div className={css.list}>
          {data.found.map((r) => (
            <div key={r.id} className={css.entry}>
              <GameItem
                variant="reason"
                game={toGameView(ix, r.row, {
                  owned: r.mine,
                  pinned: state.pinned.includes(r.id),
                  blocked: state.blocked.includes(r.id),
                  reason: `${r.filledBy.name} already covers ${Math.round(r.share * 100)}%`
                    + ' of what it brings.',
                })}
                onOpen={onOpen}
                onPin={(x) => actions.pin(x.id, shelvedNow(built), x.name)}
                onBlock={(x) => actions.block(x.id, shelvedNow(built), x.name)} />
            </div>
          ))}
        </div>
        <p className={css.note}>
          How much of a game's own profile another single game already covers.
          Nothing is suggested to take its place: the runner-up is the game the
          selection already turned down, and putting it in makes the shelf worse.
        </p>
      </div>
    );
  },
});
