import css from './Radar.module.css';

/**
 * What a *set* of games covers, spoke by spoke.
 *
 * A radar is the right shape for a collection and the wrong one for a game.
 * Measured: the twelve-game collection touches 12 of 12 spokes (0.48–0.93) and
 * a thirteen-game shelf touches 12 of 12 (0.14–0.86) — both draw a full figure.
 * Ra touches 4, and eight of its twelve points sit on the origin. So sets get a
 * radar and a single game gets `Bars`, which has room for the axes underneath.
 *
 * Two series overlay: what you have, against what the collection would cover.
 * The gap between the shapes is the analysis — it is the only place in the
 * interface where "you are thin here" is a picture rather than a sentence.
 */

const START = -Math.PI / 2;          // first spoke at twelve o'clock
const RINGS = [0.25, 0.5, 0.75, 1];

/** Long spoke names collide at twelve points, so they wrap rather than overlap. */
function wrap(label, max = 13) {
  const words = label.split(' ');
  const lines = [''];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if (!line) lines[lines.length - 1] = word;
    else if (line.length + 1 + word.length <= max) lines[lines.length - 1] = `${line} ${word}`;
    else lines.push(word);
  }
  return lines.slice(0, 2);
}

function polygon(values, cx, cy, radius) {
  return values.map((v, i) => {
    const angle = START + (i * 2 * Math.PI) / values.length;
    const r = radius * Math.max(0, Math.min(1, v));
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

export default function Radar({
  names, values, reference = null,
  label = 'Yours', referenceLabel = 'The collection',
  size = 300, showGaps = true, gapCount = 3,
}) {
  if (!names?.length || !values?.length) return null;
  const n = names.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 46;      // room for two lines of label outside the web

  const spokes = names.map((name, i) => {
    const angle = START + (i * 2 * Math.PI) / n;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      name, i, angle,
      x1: cx + radius * cos, y1: cy + radius * sin,
      lx: cx + (radius + 13) * cos, ly: cy + (radius + 13) * sin,
      anchor: Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end',
      lines: wrap(name),
      near: reference ? reference[i] - values[i] > 0.2 : false,
    };
  });

  const gaps = reference
    ? names.map((name, i) => ({ name, short: reference[i] - values[i] }))
        .filter((g) => g.short > 0)
        .sort((a, b) => b.short - a.short)
        .slice(0, gapCount)
    : [];

  return (
    <div className={css.wrap}>
      <svg className={css.plot} viewBox={`0 0 ${size} ${size}`}
           role="img" aria-label={`${label} coverage across ${n} kinds of play`}>
        {RINGS.map((ring) => (
          <polygon key={ring} className={css.web}
                   points={polygon(names.map(() => ring), cx, cy, radius)} />
        ))}
        {spokes.map((s) => (
          <line key={`s${s.i}`} className={css.spoke} x1={cx} y1={cy} x2={s.x1} y2={s.y1} />
        ))}

        {reference && (
          <polygon className={`${css.shape} ${css['shape--outline']}`}
                   points={polygon(reference, cx, cy, radius)} />
        )}
        <polygon className={`${css.shape} ${css['shape--fill']}`}
                 points={polygon(values, cx, cy, radius)} />
        {values.map((v, i) => {
          const angle = START + (i * 2 * Math.PI) / n;
          const r = radius * Math.max(0, Math.min(1, v));
          return (
            <circle key={`d${i}`} className={css.dot} r={1.8}
                    cx={cx + r * Math.cos(angle)} cy={cy + r * Math.sin(angle)} />
          );
        })}

        {spokes.map((s) => (
          <text key={`t${s.i}`} x={s.lx} y={s.ly} textAnchor={s.anchor}
                className={`${css.axis} ${s.near ? css['axis--near'] : ''}`}
                dy={s.lines.length > 1 ? '-0.15em' : '0.32em'}>
            {s.lines.map((line, li) => (
              <tspan key={line} x={s.lx} dy={li ? '1.15em' : 0}>{line}</tspan>
            ))}
          </text>
        ))}
      </svg>

      <div className={css.key}>
        <span className={css.keyItem}><span className={css.swatch} />{label}</span>
        {reference && (
          <span className={css.keyItem}>
            <span className={`${css.swatch} ${css['swatch--outline']}`} />{referenceLabel}
          </span>
        )}
      </div>

      {showGaps && gaps.length > 0 && (
        <div className={css.gaps}>
          {gaps.map((g) => (
            <span key={g.name} className={css.gap}>
              <span>{g.name}</span><b>−{g.short.toFixed(2)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
