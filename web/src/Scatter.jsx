import React, { useState } from 'react'
import { colorFor } from './colors.js'

// A small inline-SVG map of one cell's games, using the global 2-D projection
// of the feature space (so positions are comparable across cells). Picks are
// colored by their type label; alternates are gray. Hover names a point.
export default function Scatter({ assignments, alternates }) {
  const [hovered, setHovered] = useState(null)

  const points = [
    ...assignments.map(({ archetype, game }) => ({ game, color: colorFor(archetype) })),
    ...alternates.map((game) => ({ game, color: null })),
  ]
  if (points.length < 2) return null // a one-point map says nothing

  // Fit this cell's points into the viewbox with a little padding.
  const xs = points.map((p) => p.game.x)
  const ys = points.map((p) => p.game.y)
  const pad = 0.08
  const span = (lo, hi) => (hi - lo) || 1
  const sx = (x) => pad + (1 - 2 * pad) * ((x - Math.min(...xs)) / span(Math.min(...xs), Math.max(...xs)))
  const sy = (y) => pad + (1 - 2 * pad) * ((y - Math.min(...ys)) / span(Math.min(...ys), Math.max(...ys)))

  return (
    <figure className="scatter">
      <svg viewBox="0 0 1 0.62" onMouseLeave={() => setHovered(null)}>
        {points.map(({ game, color }) => (
          <circle
            key={game.id}
            cx={sx(game.x)}
            cy={0.62 * sy(game.y)}
            r={hovered === game.id ? 0.028 : color ? 0.022 : 0.014}
            fill={color || 'var(--muted)'}
            opacity={color ? 0.95 : 0.45}
            onMouseEnter={() => setHovered(game.id)}
          />
        ))}
      </svg>
      <figcaption className="muted">
        {hovered
          ? points.find((p) => p.game.id === hovered)?.game.name
          : 'Game similarity map — colored: picks, gray: alternates'}
      </figcaption>
    </figure>
  )
}
