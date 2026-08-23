import { overRepresented } from '../../engine/index.js';
import { register } from './registry.js';
import css from './analysis.module.css';

/**
 * Which kinds of play you hold more of than you need.
 *
 * On the raw axes, not the twelve families: per-axis cohesion is 3.11x against
 * 2.52x, and "four of your games do worker placement with dice workers" is a
 * sentence worth reading where "four of your games are Abstract Strategy ·
 * Pattern Building" is not.
 *
 * It reports axes, never games. A per-game "carrying least" ranking was tried
 * four ways and none of them separates — the note at the foot of
 * `engine/shelf.js` records why, and it is structural rather than a missing
 * idea. Surplus on one axis is not the same as unwanted: the game spare here may
 * be the only thing carrying somewhere else.
 */
export default register({
  id: 'over-represented',
  scope: 'mine',
  run({ built, state }) {
    const { ix } = built;
    const enough = ix.defaults?.representationEnough ?? 0.95;
    const rows = state.owned.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
    if (rows.length < 4) return null;
    const { axes } = overRepresented(ix, rows, { enough });
    return axes.length ? { axes: axes.slice(0, 5), owned: rows.length } : null;
  },
  View({ data }) {
    return (
      <div className={css.block}>
        <h2 className={css.label}>More of these than you need</h2>
        <div className={css.facts}>
          {data.axes.map((a) => (
            <span key={a.axis} className={css.fact}>
              <span>{a.name.split(' · ')[0]}</span>
              <b>{a.need} of {a.held}</b>
            </span>
          ))}
        </div>
        <p className={css.note}>
          Of your {data.owned} games, how many it takes to cover each kind as
          fully as all of them do. Spare on one axis is not spare outright — the
          game you could drop here may be the only one carrying somewhere else.
        </p>
      </div>
    );
  },
});
