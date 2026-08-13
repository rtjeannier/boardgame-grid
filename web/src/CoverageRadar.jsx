import React from 'react'
import Radar from './Radar.jsx'
import { axisCoverage } from './coverage.js'
import { gameColor } from './colors.js'

// The radar with its two views, both drawn from the origin:
//
// - Combined: the base shapes (full coverage, anchors) with one extra polygon
//   for the union coverage of whichever games are selected — multi-select in
//   the list to build up a sub-collection and see what it covers together.
// - Individual: every game as its own radar polygon overlaid on the others.
//   Selecting games spotlights them (their palette colour, matching the list
//   row) and fades the rest to outlines; the base shape stays as a dashed
//   reference so "the whole" is always visible behind "the parts".
//
// Selection lives in the parent (it owns the list rows); the mode toggle is
// rendered here beside the chart it controls.
export default function CoverageRadar({ dimensions, baseLayers, games, selected, mode, onMode, idleCaption }) {
  const n = dimensions.length
  const chosen = games.filter((g) => selected.has(g.id))

  const polygons = []
  if (mode === 'combined') {
    polygons.push(...baseLayers)
    if (chosen.length) {
      polygons.push({
        key: 'selection',
        values: axisCoverage(chosen.map((g) => g.coverage), n),
        className: 'radar__highlight',
      })
    }
  } else {
    // Dashed reference of the whole, then faded games, then spotlit games on
    // top. With nothing selected every game is spotlit.
    const spotlight = chosen.length > 0
    const faded = [], lit = []
    games.forEach((g, i) => {
      if (!g.coverage) return
      if (spotlight && !selected.has(g.id)) {
        faded.push({ key: g.id, values: g.coverage, className: 'radar__game radar__game--faded' })
      } else {
        lit.push({ key: g.id, values: g.coverage, className: 'radar__game',
                   style: { fill: gameColor(i), stroke: gameColor(i) } })
      }
    })
    polygons.push({ ...baseLayers[0], key: 'context', className: 'radar__context' }, ...faded, ...lit)
  }

  const names = chosen.map((g) => g.name)
  const caption =
    chosen.length === 0
      ? mode === 'combined'
        ? idleCaption
        : 'each shape is one game — click games in the list to spotlight them'
      : mode === 'combined'
        ? <>combined coverage of <strong>{names.length <= 3 ? names.join(', ') : `${names.length} games`}</strong> · click a game again to remove it</>
        : <>spotlighting <strong>{names.length <= 3 ? names.join(', ') : `${names.length} games`}</strong> · click a game again to remove it</>

  return (
    <>
      <div className="radar-mode" role="group" aria-label="Radar view">
        {[['combined', 'Combined'], ['individual', 'Individual games']].map(([key, label]) => (
          <button key={key}
            className={`radar-mode__btn ${mode === key ? 'radar-mode__btn--on' : ''}`}
            onClick={() => onMode(key)}>
            {label}
          </button>
        ))}
      </div>
      <Radar dimensions={dimensions} polygons={polygons} />
      <p className="muted collection__caption">{caption}</p>
    </>
  )
}
