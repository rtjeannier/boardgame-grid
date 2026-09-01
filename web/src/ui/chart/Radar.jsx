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

/**
 * Where a spoke's point sits, on a scale where equal coverage covers equal area.
 *
 * The square root is the whole of it. A polygon's area grows with the square of
 * its radii, so drawing a spoke at `radius * coverage` makes a fixed gain almost
 * invisible near the middle and large near the edge: measured over fourteen
 * games added one at a time, the second gained 0.98 and moved the drawn area
 * 0.01, while the fourth gained 0.94 and moved it 1.21. How well the picture
 * tracked the model's own gain: 0.09. At `radius * sqrt(coverage)` it is 0.50
 * and the worst step-to-step distortion falls from 92x to 8.6x.
 *
 * Both ends are exactly where they were — sqrt(1) is 1 and sqrt(0) is 0 — so a
 * full shape still looks full. Only the middle moves outward, which is where the
 * distortion was.
 */
function pointAt(v, i, n, cx, cy, radius) {
  const angle = START + (i * 2 * Math.PI) / n;
  const r = radius * Math.sqrt(Math.max(0, Math.min(1, v)));
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function polygon(values, cx, cy, radius) {
  return values.map((v, i) => {
    const [x, y] = pointAt(v, i, values.length, cx, cy, radius);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
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

  // Sorted by how far short of the reference each spoke falls, and kept apart
  // by whether the shelf reaches the kind *at all* — "reaches no Deduction" and
  // "reaches least of Deduction" are different claims, and the first one was
  // being made for a spoke sitting at 0.12.
  const gaps = reference
    ? names.map((name, i) => ({ name, short: reference[i] - values[i], value: values[i] }))
        .filter((g) => g.short > 0)
        .sort((a, b) => b.short - a.short)
        .slice(0, gapCount)
    : [];
  const list = (gs) => gs.map((g) => g.name).join(', ').replace(/, ([^,]*)$/, ' or $1');
  const none = gaps.filter((g) => g.value < 0.005);
  const thin = gaps.filter((g) => g.value >= 0.005);

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
          const [x, y] = pointAt(v, i, n, cx, cy, radius);
          return <circle key={`d${i}`} className={css.dot} r={1.8} cx={x} cy={y} />;
        })}

        {spokes.map((s) => (
          <text key={`t${s.i}`} x={s.lx} y={s.ly} textAnchor={s.anchor}
                className={`${css.axis} ${s.near ? css['axis--near'] : ''}`}
                dy={s.lines.length > 1 ? '-0.15em' : '0.32em'}>
            {/* Keyed by position: a name that wraps to two identical words
                collides on the text. */}
            {s.lines.map((line, li) => (
              <tspan key={li} x={s.lx} dy={li ? '1.15em' : 0}>{line}</tspan>
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

      {/* Said in words. It used to print the raw coverage difference, so a
          shelf holding none of a kind the collection covers fully read
          "Deduction −1.00" — a number on a scale nobody was shown. */}
      {showGaps && gaps.length > 0 && (
        <p className={css.gaps}>
          {none.length > 0 && `Reaches no ${list(none)}.`}
          {none.length > 0 && thin.length > 0 && ' '}
          {thin.length > 0 && `Thinnest on ${list(thin)}.`}
        </p>
      )}
    </div>
  );
}
