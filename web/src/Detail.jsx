import React, { useState } from 'react'
import Scatter from './Scatter.jsx'
import Radar from './Radar.jsx'
import { axisCoverage, contributionBand } from './coverage.js'
import { colorFor } from './colors.js'

// Slide-in panel for a single cell: a genre-coverage radar for the cell's
// picks (click a game to see its contribution), the similarity scatter, the
// full list of picks, and the runner-up games that lost their slot.
export default function Detail({ cell, meta, active, onClose }) {
  const row = meta.weightRows.find((r) => r.index === cell.row)
  const dims = meta.genreDimensions
  const [highlightId, setHighlightId] = useState(null)

  // The radar shows what the cell's picks cover. A highlighted pick shows its
  // marginal band inside that shape (picks are in greedy order, so bands
  // stack to the full polygon); a highlighted alternate isn't part of the
  // shape, so its band is what it *would* add on top of the current coverage.
  const picks = cell.assignments.map((a) => a.game)
  const pickVectors = picks.map((g) => g.coverage)
  const cellCoverage = axisCoverage(pickVectors, dims.length)

  const pickIndex = picks.findIndex((g) => g.id === highlightId)
  const alternate = cell.alternates.find((g) => g.id === highlightId) || null
  const highlighted = pickIndex >= 0 ? picks[pickIndex] : alternate
  const band = pickIndex >= 0
    ? contributionBand(pickVectors, pickIndex, dims.length)
    : alternate && alternate.coverage
      ? { inner: cellCoverage, outer: axisCoverage([...pickVectors, alternate.coverage], dims.length) }
      : null
  const toggle = (id) => setHighlightId((cur) => (cur === id ? null : id))

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
        <Radar
          dimensions={dims}
          layers={[{ key: 'cell', values: cellCoverage, className: 'radar__full' }]}
          band={band}
        />
        <p className="muted collection__caption">
          {highlighted
            ? alternate
              ? <>what <strong>{highlighted.name}</strong> would add · click it again to clear</>
              : <>highlighting <strong>{highlighted.name}</strong>’s contribution · click it again to clear</>
            : 'Genre coverage of this cell — click a game to see its contribution'}
        </p>
      </div>

      <Scatter assignments={cell.assignments} alternates={cell.alternates} />

      <ul className="detail__list">
        {cell.assignments.map(({ archetype, game, gain }) => {
          const dim = active.size > 0 && !active.has(archetype)
          return (
            <li key={game.id}
              className={`detail__row ${dim ? 'row--dim' : ''} ${highlightId === game.id ? 'is-highlit' : ''}`}
              onClick={() => toggle(game.id)}
              role="button" tabIndex={0} aria-pressed={highlightId === game.id}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(game.id) } }}>
              <span className="dot" style={{ background: colorFor(archetype) }} />
              <div className="detail__game">
                <a href={game.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{game.name}</a>
                <span className="muted">
                  {archetype}
                  {gain != null && ` · +${gain.toFixed(2)} coverage`}
                </span>
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
              <li key={game.id}
                className={`detail__row ${highlightId === game.id ? 'is-highlit' : ''}`}
                onClick={() => toggle(game.id)}
                role="button" tabIndex={0} aria-pressed={highlightId === game.id}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(game.id) } }}>
                <span className="dot dot--muted" />
                <div className="detail__game">
                  <a href={game.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{game.name}</a>
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
