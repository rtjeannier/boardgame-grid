import Panel from '../primitives/Panel.jsx';
import Button from '../primitives/Button.jsx';
import css from './Settings.module.css';

/**
 * Everything that shapes the collection but does not belong on top of it.
 *
 * What is deliberately absent: the numbers that fit the model. They ship in the
 * contract's `policy`, the interface applies them, and putting them on a screen
 * would only invite breaking a fit nobody can see from here.
 */
export default function Settings({ built, state, actions }) {
  const { ix, depths, columns, rows } = built;
  const defaults = ix.defaults ?? {};
  const leftover = defaults.autoDepthLeftover ?? 0.45;

  const readings = [
    ...[...(depths?.columnDepth ?? [])].map(([key, r]) => ({
      where: `Players · ${key}`, ...r,
    })),
    ...[...(depths?.rowDepth ?? [])].map(([key, r]) => ({
      where: `Weight · ${rows.find((x) => String(x.index) === key)?.name ?? key}`, ...r,
    })),
  ];
  const fired = readings.filter((r) => r.auto).length;

  return (
    <div className={css.view}>
      <div className={css.col}>
        <Panel title="How deep a shelf goes"
               blurb={'A shelf fills until the next game would not be worth the space. '
                 + 'Finding that point means spotting where the fall in value is sharpest '
                 + '— but only when the fall is decisive. This is how decisive it has to '
                 + 'be: what the next game would still have added, as a share of what the '
                 + 'first one did.'}>
          <div className={css.field}>
            <span className={css.head}>
              <span>Stop only if less than this is left on the table</span>
              <b>{Math.round(leftover * 100)}%</b>
            </span>
            <input className={css.range} type="range" min="0" max="100"
                   value={Math.round(leftover * 100)} readOnly
                   aria-label="How decisive the fall must be" />
            <span className={css.scale}>
              <span>0% stops almost never</span><span>100% stops anywhere</span>
            </span>
          </div>

          {readings.length > 0 && (
            <table className={css.table}>
              <thead>
                <tr><th>Read down</th><th>Stops at</th><th>Left behind</th><th>Used it?</th></tr>
              </thead>
              <tbody>
                {readings.map((r) => (
                  <tr key={r.where} className={r.auto ? '' : css.fellBack}>
                    <td className={css.where}>{r.where}</td>
                    <td>{r.depth}</td>
                    <td>{r.left == null ? '—' : `${Math.round(r.left * 100)}%`}</td>
                    <td>{r.auto ? 'yes' : 'fell back'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={css.foot}>
            {fired} of {readings.length} readings were decisive. The rest fall back
            to {defaults.picksPerCell ?? 5} and say so on the shelf itself. A cell
            takes the smaller of its column's answer and its row's, which is why
            nine-plus players holds one game per shelf without anyone capping it.
          </p>
        </Panel>

        <Panel title="Start again"
               blurb="Clears what you own, every pin and block, and every depth you typed.">
          <div><Button tone="quiet" onClick={actions.reset}>Reset everything</Button></div>
        </Panel>
      </div>

      <div className={css.col}>
        <Panel title="Weight bands"
               blurb={'The defaults are quantiles of the corpus, so each holds a '
                 + 'comparable number of games. Move an edge and that stops being true.'}>
          <div className={css.field}>
            <span className={css.head}>
              <span>How many</span><b>{state.rowCount}</b>
            </span>
            <input className={css.range} type="range" min="3" max="6" value={state.rowCount}
                   onChange={(e) => actions.setRows(Number(e.target.value))}
                   aria-label="How many weight bands" />
          </div>
          <div className={css.rows}>
            {rows.map((r) => (
              <div key={r.index} className={css.row}>
                <span className={css.name}>{r.name}</span>
                <span className={css.edge}>{r.lo.toFixed(2)} to {r.hi.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Player groups"
               blurb={'A game sits in every group it can be played at, by degree '
                 + 'rather than exclusively.'}>
          <div className={css.rows}>
            {columns.map((c) => (
              <div key={c.label} className={css.row}>
                <span className={css.name}>{c.label}</span>
                <span className={css.edge}>
                  {c.lo} to {c.hi ?? '—'}
                </span>
              </div>
            ))}
          </div>
          <div className={css.flag}>
            <b>Check</b>
            <span>
              The last group is labelled 8+ but starts at nine, so eight-player
              games fall in 6-8 only. Either the label or the edge is wrong.
            </span>
          </div>
        </Panel>
      </div>

      <p className={`${css.foot} ${css.wide}`}>
        What is not here: the numbers that fit the model itself — how quality is
        weighted, how similarity is discounted, how the tag clusters are grown.
        Those are tuned once against the four measurements this repo judges
        changes on, and putting them on a screen would only invite breaking a fit
        nobody can see from here.
      </p>
    </div>
  );
}
