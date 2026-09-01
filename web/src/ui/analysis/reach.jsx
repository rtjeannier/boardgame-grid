import { axisVector, coverageOf } from '../../engine/index.js';
import Radar from '../chart/Radar.jsx';
import { rowsOfPicks } from '../shelved.js';
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
  const rowsOf = (picks) => rowsOfPicks(ix, picks);
  // A projection of the one measurement, not a second one. Coverage is computed
  // on the 77 weighted axes — the space everything else uses — and then summed
  // into the twelve families for drawing, each scaled by what its family is
  // worth so a full spoke reads 1. Measuring the spokes directly instead is how
  // Navegador came out 96% duplicated at 0.00 similarity, and how one game read
  // 0.15% where the selector had it at 1.86%.
  const shape = (rs) => {
    const covered = coverageOf(rs.map((r) => axisVector(ix, weights, r)), ix.nAxes);
    const per = new Array(n).fill(0);
    const room = new Array(n).fill(0);
    for (let a = 0; a < ix.nAxes; a += 1) {
      per[ix.groupOf[a]] += covered[a] * ix.axisWeight[a];
      room[ix.groupOf[a]] += ix.axisWeight[a];
    }
    return per.map((v, i) => (room[i] > 0 ? v / room[i] : 0));
  };
  const whole = shape(rowsOf(grid.flatMap((c) => c.picks)));

  const picked = subject?.kind === 'cell' ? subject.cell : null;
  if (picked) {
    /**
     * A shelf is drawn the way the collection is, over a smaller population.
     *
     * The collection radar is one shape and no overlay: how far the games it
     * holds reach into each of the twelve families, out of everything there is
     * to reach. A shelf asked that same question of the whole corpus answered
     * 0.069 and drew as a speck — but the corpus is not what a shelf is
     * reaching into. It can only ever hold games that pass its player-count and
     * weight constraints, so that pool is what "everything there is to reach"
     * means here.
     *
     * `built.cells` are those pools. Dividing by what the pool covers gives the
     * same reading the collection gets, over the population the constraints
     * actually allow: the same shelf reads 0.151, and a full spoke means it
     * reaches everything reachable under these constraints rather than
     * everything in the corpus.
     *
     * It is still not a full shape, and it should not be — eight games reach
     * about a seventh of what the two hundred that qualify here do. Costs 10 ms
     * across all 35 shelves.
     */
    // Every shelf comes out of `built.grid`, which comes out of these pools, so
    // there is always one to divide by.
    const pool = built.cells.find((c) => c.key === picked.key);
    const mine = shape(rowsOf(picked.picks));
    const ceiling = shape([...pool.games]);
    return {
      names,
      values: mine.map((v, i) => (ceiling[i] > 0 ? Math.min(1, v / ceiling[i]) : 0)),
      reference: null,
      label: `This shelf · ${picked.picks.length} games`,
      heading: 'What this shelf reaches',
      note: 'Twelve kinds of play, and how far this shelf reaches into each — out '
        + `of what the ${pool.games.length} games that fit here could reach, not the `
        + 'whole corpus. A full spoke is everything reachable under these constraints.',
    };
  }
  const mine = state.owned.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
  if (mine.length) {
    return {
      names, values: shape(mine), reference: whole,
      label: 'Yours', referenceLabel: 'The collection',
      heading: 'Yours against the collection', note: null,
    };
  }
  return {
    names, values: whole, reference: null, label: 'The collection',
    heading: 'What it reaches',
    note: Math.min(...whole) > 0.95
      ? 'At this size the collection reaches every kind of play, so the shape is '
        + 'full and one game cannot move it. Click a shelf, or add your own games, '
        + 'and this draws something small enough to respond.'
      : 'Twelve kinds of play, and how far the collection reaches into each. '
        + 'Add your own games and this draws them against it.',
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
        {/* The shape says what its own note is. The view used to pick between
            two sentences about the collection, which were the wrong sentences
            the moment anything else was being drawn. */}
        {data.note && <p className={css.note}>{data.note}</p>}
      </div>
    );
  },
});
