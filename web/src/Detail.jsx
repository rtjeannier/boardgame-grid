import React, { useState } from 'react'
import Scatter from './Scatter.jsx'
import CoverageRadar from './CoverageRadar.jsx'
import { colorFor, gameColor } from './colors.js'

// Slide-in panel for a single cell: a genre-coverage radar for the cell's
// games, the similarity scatter, the full list of picks, and the runner-up
// games that lost their slot. Games (picks and alternates alike) are
// multi-selectable: the radar draws the selection's combined coverage from
// the origin, or each game as its own overlaid polygon.
export default function Detail({ cell, meta, active, onClose }) {
  const row = meta.weightRows.find((r) => r.index === cell.row)
  const dims = meta.genreDimensions
  const [selected, setSelected] = useState(() => new Set())
  const [mode, setMode] = useState('combined')

  // Picks make up the blue stack; alternates only appear on the radar when
  // selected, stacking above the cell's total since they add coverage it
  // didn't have. Selected rows carry the same colour as their segment/bars.
  const picks = cell.assignments.map((a) => a.game)
  const games = [...picks, ...cell.alternates]
  const baseIds = new Set(picks.map((g) => g.id))

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const rowProps = (game) => ({
    className: `detail__row ${selected.has(game.id) ? 'is-highlit' : ''}`,
    style: selected.has(game.id)
      ? { boxShadow: `inset 3px 0 0 ${gameColor(games.findIndex((g) => g.id === game.id))}` }
      : undefined,
    onClick: () => toggle(game.id),
    role: 'button', tabIndex: 0, 'aria-pressed': selected.has(game.id),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(game.id) } },
  })

  return (
    <aside className="detail">
      <div className="detail__head">
        <div>
          <h2>{cell.column} players · {row.name}</h2>
          <p className="muted">weight {row.lo}–{row.hi} · {cell.candidateCount} qualifying games</p>
        </div>
        <button className="detail__close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="detail__radar">
        <CoverageRadar
          dimensions={dims}
          games={games}
          baseIds={baseIds}
          selected={selected}
          mode={mode}
          onMode={setMode}
          idleCaption="Genre coverage of this cell — click games to chart them"
        />
      </div>

      <Scatter assignments={cell.assignments} alternates={cell.alternates} />

      <ul className="detail__list">
        {cell.assignments.map(({ archetype, game, gain }) => {
          const dim = active.size > 0 && !active.has(archetype)
          const props = rowProps(game)
          return (
            <li key={game.id} {...props}
              className={`${props.className} ${dim ? 'row--dim' : ''}`}>
              <span className="dot" style={{ background: colorFor(archetype) }} />
              <div className="detail__game">
                <a href={game.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{game.name}</a>
                <span className="muted">
                  {archetype}
                  {gain != null && ` · +${gain.toFixed(2)} coverage`}
                </span>
                <Genres genres={game.genres} />
                <Stats game={game} />
              </div>
            </li>
          )
        })}
      </ul>

      {cell.alternates.length > 0 && (
        <div className="detail__alts">
          <h3>Also here</h3>
          <ul className="detail__list">
            {cell.alternates.map((game) => (
              <li key={game.id} {...rowProps(game)}>
                <span className="dot dot--muted" />
                <div className="detail__game">
                  <a href={game.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{game.name}</a>
                  <Stats game={game} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}

function Stats({ game }) {
  return (
    <span className="detail__stats muted">
      #{game.rank} · w{game.weight.toFixed(1)} · {game.playtime}′ · best {playerRange(game.best_counts)}
    </span>
  )
}

// "6, 7, 8, ... 18" is unreadable and squeezed the game name out of the row, so
// collapse consecutive counts into ranges: [2,3,4,6] -> "2–4, 6".
function playerRange(counts) {
  if (!counts?.length) return '—'
  const sorted = [...counts].sort((a, b) => a - b)
  const runs = []
  for (const n of sorted) {
    const last = runs[runs.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  return runs.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`)).join(', ')
}

// A game's strongest latent genre dimensions, e.g. "0.71 tile-laying · 0.30
// set-collection" — the continuous "what kind of game is this" signal.
function Genres({ genres }) {
  if (!genres?.length) return null
  return (
    <span className="detail__genres muted">
      {genres.map(({ name, value }) => `${value} ${name.split(' / ')[0].toLowerCase()}`).join(' · ')}
    </span>
  )
}
