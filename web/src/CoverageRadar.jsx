import React from 'react'
import Radar from './Radar.jsx'
import { axisCoverage } from './coverage.js'
import { gameColor } from './colors.js'

// The polar-bar radar with its two views:
//
// - Combined: the base bars (full coverage, anchors) with one extra set of
//   bars for the union coverage of whichever games are selected — multi-select
//   in the list to build up a sub-collection and see what it covers together.
// - Individual: every game's bars overlaid on the others. Selecting games
//   spotlights them (their palette colour, matching the list row) and fades
//   the rest to arc outlines; the whole stays behind as a dashed reference.
//
// Selection lives in the parent (it owns the list rows); the mode toggle is
// rendered here beside the chart it controls.
export default function CoverageRadar({ dimensions, baseLayers, games, selected, mode, onMode, idleCaption }) {
  const n = dimensions.length
  const chosen = games.filter((g) => selected.has(g.id))

  const series = []
  if (mode === 'combined') {
    series.push(...baseLayers)
    if (chosen.length) {
      series.push({
        key: 'selection',
        values: axisCoverage(chosen.map((g) => g.coverage), n),
        className: 'radar__highlight',
      })
    }
  } else {
    // Dashed arc reference of the whole, then faded games (arc outlines only),
    // then spotlit games as filled bars on top. With nothing selected every
    // game is spotlit.
    const spotlight = chosen.length > 0
    const faded = [], lit = []
    games.forEach((g, i) => {
      if (!g.coverage) return
      if (spotlight && !selected.has(g.id)) {
        faded.push({ key: g.id, values: g.coverage, className: 'radar__game--faded', outline: true })
      } else {
        lit.push({ key: g.id, values: g.coverage, className: 'radar__game',
                   style: { fill: gameColor(i), stroke: gameColor(i) } })
      }
    })
    series.push({ ...baseLayers[0], key: 'context', className: 'radar__context', outline: true }, ...faded, ...lit)
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
      <Radar dimensions={dimensions} series={series} />
      <p className="muted collection__caption">{caption}</p>
    </>
  )
}
