import { coverageOf, spokeVector } from '../../engine/index.js';
import Radar from '../chart/Radar.jsx';
import { register } from './registry.js';
import css from './analysis.module.css';

/**
 * What a set of games reaches, across the twelve families.
 *
 * It draws whatever is small enough to respond. A five-game shelf moves 0.10-0.26
 * when one game changes and your thirteen move 0.18-0.35; the whole 272-game
 * collection moves 0.0000, because one game in 272 is a third of a percent and no
 * measure can make that four pixels. So: the shelf you picked, else your games,
 * else the collection as a portrait that says it is one.
 */
function shapes({ built, state, subject }) {
  const { ix, grid, weights } = built;
  const n = ix.groups.length;
  const names = ix.groups.map((g) => g.name.split(' · ')[0]);
  const rowsOf = (picks) => picks.map((p) => ix.rowOf.get(p.id)).filter((r) => r !== undefined);
  const shape = (rs) => coverageOf(rs.map((r) => spokeVector(ix, weights, r, n)), n);
  const whole = shape(rowsOf(grid.flatMap((c) => c.picks)));

  const picked = subject?.kind === 'cell' ? subject.cell : null;
  if (picked) {
    return {
      names, values: shape(rowsOf(picked.picks)), reference: whole,
      label: `This shelf · ${picked.picks.length} games`, referenceLabel: 'The collection',
      heading: 'What this shelf reaches', picked: true,
    };
  }
  const mine = state.owned.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
  if (mine.length) {
    return {
      names, values: shape(mine), reference: whole,
      label: 'Yours', referenceLabel: 'The collection',
      heading: 'Yours against the collection',
    };
  }
  return {
    names, values: whole, reference: null, label: 'The collection',
    heading: 'What it reaches', full: Math.min(...whole) > 0.95,
  };
}

export default register({
  id: 'reach',
  scope: 'collection',
  run: shapes,
  View({ data }) {
    return (
      <div className={css.block}>
        <h2 className={css.label}>{data.heading}</h2>
        <Radar names={data.names} values={data.values} reference={data.reference}
               label={data.label} referenceLabel={data.referenceLabel}
               showGaps={!!data.reference} size={272} />
        {!data.reference && (
          <p className={css.note}>
            {data.full
              ? 'At this size the collection reaches every kind of play, so the shape '
                + 'is full and one game cannot move it. Click a shelf, or add your own '
                + 'games, and this draws something small enough to respond.'
              : 'Twelve kinds of play, and how far the collection reaches into each. '
                + 'Add your own games and this draws them against it.'}
          </p>
        )}
      </div>
    );
  },
});
