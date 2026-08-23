import { register } from './registry.js';
import css from './analysis.module.css';

/** Who can play it, how long it runs, how heavy it is, how far down it reaches. */
export default register({
  id: 'contains',
  scope: 'collection',
  run({ built }) {
    const { ix, grid } = built;
    const rows = grid.flatMap((c) => c.picks.map((p) => ix.rowOf.get(p.id)))
      .filter((r) => r !== undefined);
    if (!rows.length) return null;

    const plays = (lo, hi) => rows.filter((r) => {
      for (let k = ix.playerFit.start[r]; k < ix.playerFit.start[r + 1]; k++) {
        const c = ix.playerFit.idx[k];
        if (ix.playerFit.val[k] >= 0.999 && c >= lo && (hi == null || c <= hi)) return true;
      }
      return false;
    }).length;
    const sorted = (pick) => rows.map(pick).sort((a, b) => a - b);
    const times = sorted((r) => ix.playtime[r]);
    const weights = sorted((r) => ix.weight[r]);
    const ranks = sorted((r) => ix.rank[r]);
    const hours = (m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${m}m`);
    const last = (a) => a[a.length - 1];

    return [
      ['Plays alone', String(plays(1, 1))],
      ['Plays at two', String(plays(2, 2))],
      ['Takes eight or more', String(plays(8, null))],
      ['Shortest', hours(times[0])],
      ['Longest', hours(last(times))],
      ['Weight', `${weights[0].toFixed(1)} – ${last(weights).toFixed(1)}`],
      ['Best known', `#${ranks[0]}`],
      ['Least known', `#${last(ranks).toLocaleString()}`],
    ];
  },
  View({ data }) {
    return (
      <div className={css.block}>
        <h2 className={css.label}>What it contains</h2>
        <div className={css.facts}>
          {data.map(([label, value]) => (
            <span key={label} className={css.fact}><span>{label}</span><b>{value}</b></span>
          ))}
        </div>
      </div>
    );
  },
});
