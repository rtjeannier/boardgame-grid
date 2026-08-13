import React from 'react'

// Spoke labels use a dimension's first signal, shortened where BGG's official
// name is too long to sit beside the chart.
const SHORT = { 'Deck, Bag, and Pool Building': 'Deck Building' }
const label = (dim) => {
  const first = dim.split(' / ')[0]
  return SHORT[first] || first
}

// A polar bar chart: each genre dimension owns an angular sector, and a value
// fills that sector from the center out to an arc at its radius — bars, not a
// connected polygon, so a shape covering two distant genres reads as two solid
// bars instead of spikes through the middle. `series` are drawn back to front;
// each is {values, className, style, outline} — `outline` renders only the top
// arc (used for dashed references and faded games) instead of a filled bar.
export default function Radar({ dimensions, series }) {
  const n = dimensions.length
  const cx = 0.5, cy = 0.5, R = 0.33
  const half = (Math.PI / n) * 0.82 // bar half-width; the rest is the gap between bars
  const angle = (i) => (2 * Math.PI * i) / n - Math.PI / 2
  const pt = (a, r) => `${cx + R * r * Math.cos(a)},${cy + R * r * Math.sin(a)}`

  const arc = (i, v) =>
    `M ${pt(angle(i) - half, v)} A ${R * v} ${R * v} 0 0 1 ${pt(angle(i) + half, v)}`
  const bar = (i, v) => `M ${cx},${cy} L ${arc(i, v).slice(2)} Z`

  return (
    <svg className="radar" viewBox="0 0 1 1">
      {/* rings at 25/50/75/100% coverage */}
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <circle key={r} cx={cx} cy={cy} r={R * r} className="radar__ring" />
      ))}

      {series.map(({ key, values, className, style, outline }) => (
        <g key={key} className={className} style={style}>
          {values.map((v, i) =>
            v > 0.01 ? <path key={i} d={outline ? arc(i, v) : bar(i, v)} /> : null,
          )}
        </g>
      ))}

      {dimensions.map((dim, i) => {
        const x = cx + R * 1.22 * Math.cos(angle(i))
        const y = cy + R * 1.22 * Math.sin(angle(i))
        return (
          <text key={dim} x={x} y={y} className="radar__label"
            textAnchor={Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end'}>
            {label(dim)}
          </text>
        )
      })}
    </svg>
  )
}
