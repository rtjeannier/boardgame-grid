import React from 'react'
import Radar from './Radar.jsx'
import { axisCoverage } from './coverage.js'
import { gameColor } from './colors.js'

// The polar-bar radar with its two views:
//
// - Combined: a stacked bar per genre sector. Blue is the combined coverage
//   of the *unselected* games; selecting a game pulls its contribution out of
//   the blue and stacks it as its own colored segment (the colour matches the
//   game's row in the list), so the stack always tops out at the total.
//   Segments stack in list order — the pipeline's pick order — each one the
//   game's marginal contribution over what's already stacked.
// - Individual: every game's bars overlaid translucently. Selecting games
//   spotlights them and fades the rest to arc outlines; the whole stays
//   behind as a dashed reference.
//
// `baseIds` are the games whose coverage makes up the blue stack (in the cell
// drawer that's the picks — alternates only appear when selected, stacking
// *above* the cell's total since they add coverage it didn't have).
// Selection lives in the parent (it owns the list rows); the mode toggle is
// rendered here beside the chart it controls.
export default function CoverageRadar({ dimensions, games, baseIds, selected, mode, onMode, idleCaption }) {
  const n = dimensions.length
  const chosen = games.filter((g) => selected.has(g.id))

  const series = []
  if (mode === 'combined') {
    // The stack always starts at the center: selected games' colored
    // segments rise from the hole in list order, and the blue remainder —
    // the unselected games' marginal coverage — is the outermost band, so
    // the stack still tops out at the total. With nothing selected the blue
    // is the whole bar.
    let uncovered = Array(n).fill(1)
    games.forEach((g, i) => {
      if (!selected.has(g.id) || !g.coverage) return
      const next = uncovered.map((u, d) => u * (1 - g.coverage[d]))
      series.push({
        key: g.id,
        base: uncovered.map((u) => 1 - u),
        values: next.map((u) => 1 - u),
        className: 'radar__segment',
        style: { fill: gameColor(i), stroke: gameColor(i) },
      })
      uncovered = next
    })
    const rest = games.filter((g) => baseIds.has(g.id) && !selected.has(g.id))
    const restUncov = axisCoverage(rest.map((g) => g.coverage), n).map((v) => 1 - v)
    series.push({
      key: 'rest',
      base: uncovered.map((u) => 1 - u),
      values: uncovered.map((u, d) => 1 - u * restUncov[d]),
      className: 'radar__full',
    })
  } else {
    // Dashed arc reference of the whole, then faded games (arc outlines only),
    // then spotlit games as filled bars on top. With nothing selected every
    // game is spotlit.
    const spotlight = chosen.length > 0
    const whole = axisCoverage(games.filter((g) => baseIds.has(g.id)).map((g) => g.coverage), n)
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
    series.push({ key: 'context', values: whole, className: 'radar__context', outline: true }, ...faded, ...lit)
  }

  const names = chosen.map((g) => g.name)
  const caption =
    chosen.length === 0
      ? mode === 'combined'
        ? idleCaption
        : 'each bar is one game — click games in the list to spotlight them'
      : mode === 'combined'
        ? <>stacking <strong>{names.length <= 3 ? names.join(', ') : `${names.length} games`}</strong>’ contributions · click a game again to fold it back into the blue</>
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
