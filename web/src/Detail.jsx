import React from 'react'
import Scatter from './Scatter.jsx'
import { colorFor } from './colors.js'

// Slide-in panel for a single cell: the full list of archetype picks plus the
// runner-up games that were qualified but lost their slot to a better-ranked
// game of the same type.
export default function Detail({ cell, meta, active, onClose }) {
  const row = meta.weightRows.find((r) => r.index === cell.row)

  return (
    <aside className="detail">
      <div className="detail__head">
        <div>
          <h2>{cell.column} players · {row.name}</h2>
          <p className="muted">weight {row.lo}–{row.hi} · {cell.candidateCount} qualifying games</p>
        </div>
        <button className="detail__close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <Scatter assignments={cell.assignments} alternates={cell.alternates} />

      <ul className="detail__list">
        {cell.assignments.map(({ archetype, game }) => {
          const dim = active.size > 0 && !active.has(archetype)
          return (
            <li key={game.id} className={dim ? 'row--dim' : ''}>
              <span className="dot" style={{ background: colorFor(archetype) }} />
              <div className="detail__game">
                <a href={game.url} target="_blank" rel="noreferrer">{game.name}</a>
                <span className="muted">{archetype}</span>
                <Genres genres={game.genres} />
              </div>
              <Stats game={game} />
            </li>
          )
        })}
      </ul>

      {cell.alternates.length > 0 && (
        <div className="detail__alts">
          <h3>Also here</h3>
          <ul className="detail__list">
            {cell.alternates.map((game) => (
              <li key={game.id}>
                <span className="dot dot--muted" />
                <div className="detail__game">
                  <a href={game.url} target="_blank" rel="noreferrer">{game.name}</a>
                </div>
                <Stats game={game} />
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
      #{game.rank} · w{game.weight} · {game.playtime}′ · best {game.best_counts.join(', ') || '—'}
    </span>
  )
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
