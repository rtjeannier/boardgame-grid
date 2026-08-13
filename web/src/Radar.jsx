import React from 'react'

// Spoke labels use a dimension's first signal, shortened where BGG's official
// name is too long to sit beside the chart.
const SHORT = { 'Deck, Bag, and Pool Building': 'Deck Building' }
const label = (dim) => {
  const first = dim.split(' / ')[0]
  return SHORT[first] || first
}

// The coverage radar: one spoke per latent genre dimension, 0 at the center,
// fully covered (1.0) at the rim. `layers` are the filled polygons drawn back
// to front (e.g. full collection, then anchors on top; or a single cell). An
// optional `band` {inner, outer} highlights one game's slice of the shape:
// the region between two cumulative-coverage polygons (see coverage.js), so
// it shares the chart's straight-edged geometry and stays inside the rim.
export default function Radar({ dimensions, layers, band }) {
  const n = dimensions.length
  const cx = 0.5, cy = 0.5, R = 0.33
  const angle = (i) => (2 * Math.PI * i) / n - Math.PI / 2
  const point = (i, r) => `${cx + R * r * Math.cos(angle(i))},${cy + R * r * Math.sin(angle(i))}`
  const outline = (values) => values.map((v, i) => point(i, v)).join(' ')

  return (
    <svg className="radar" viewBox="0 0 1 1">
      {/* rings at 25/50/75/100% coverage */}
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={outline(Array(n).fill(r))} className="radar__ring" />
      ))}
      {dimensions.map((dim, i) => (
        <line key={dim} x1={cx} y1={cy}
          x2={cx + R * Math.cos(angle(i))} y2={cy + R * Math.sin(angle(i))}
          className="radar__spoke" />
      ))}

      {layers.map((layer) => (
        <polygon key={layer.key} points={outline(layer.values)} className={layer.className} />
      ))}

      {/* Two subpaths + evenodd = the ring between the outer and inner
          polygons: exactly the area this game adds to the chart. */}
      {band && (
        <path className="radar__highlight" fillRule="evenodd"
          d={`M ${outline(band.outer)} Z M ${outline(band.inner)} Z`} />
      )}

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
