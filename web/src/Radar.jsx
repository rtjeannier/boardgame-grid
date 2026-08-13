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
// optional `highlight` overlays one game's own coverage — its "shadow" on the
// chart — so clicking a game in the list shows exactly what it contributes.
export default function Radar({ dimensions, layers, highlight }) {
  const n = dimensions.length
  const cx = 0.5, cy = 0.5, R = 0.33
  const angle = (i) => (2 * Math.PI * i) / n - Math.PI / 2
  const at = (i, r) => [cx + R * r * Math.cos(angle(i)), cy + R * r * Math.sin(angle(i))]
  const point = (i, r) => at(i, r).join(',')
  const polygon = (values) => values.map((v, i) => point(i, v)).join(' ')

  // A game's contribution to one axis, drawn as a filled kite peaking at the
  // value on the spoke. The side vertices sit at the sector's half-angles at
  // radius v·cos(π/n) — the same outline a regular radar polygon of value v
  // traces through this sector — so the tip is a point on the spoke (matching
  // the chart's straight-edged geometry, no arcs) and wedges on adjacent axes
  // tile seamlessly. Per-axis kites (rather than one polygon through every
  // axis) keep each covered axis a solid area instead of collapsing to a
  // spike when the neighbouring axes are empty.
  const wedge = (i, v) => {
    const half = Math.PI / n
    const side = v * Math.cos(half)
    const a = angle(i)
    return [
      `${cx},${cy}`,
      `${cx + R * side * Math.cos(a - half)},${cy + R * side * Math.sin(a - half)}`,
      point(i, v),
      `${cx + R * side * Math.cos(a + half)},${cy + R * side * Math.sin(a + half)}`,
    ].join(' ')
  }

  return (
    <svg className="radar" viewBox="0 0 1 1">
      {/* rings at 25/50/75/100% coverage */}
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={polygon(Array(n).fill(r))} className="radar__ring" />
      ))}
      {dimensions.map((dim, i) => (
        <line key={dim} x1={cx} y1={cy}
          x2={cx + R * Math.cos(angle(i))} y2={cy + R * Math.sin(angle(i))}
          className="radar__spoke" />
      ))}

      {layers.map((layer) => (
        <polygon key={layer.key} points={polygon(layer.values)} className={layer.className} />
      ))}

      {/* One game's own coverage, drawn on top as a filled wedge per axis it
          reaches — reads as "this area of the chart is this game". */}
      {highlight && (
        <g className="radar__highlight-group">
          {highlight.values.map((v, i) =>
            v > 0.02 ? (
              <polygon key={i} points={wedge(i, v)} className="radar__highlight" />
            ) : null,
          )}
        </g>
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
