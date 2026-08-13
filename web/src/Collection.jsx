import React, { useEffect, useState } from 'react'
import CoverageRadar from './CoverageRadar.jsx'
import { gameColor } from './colors.js'

// The Collection tab: a radar chart of genre coverage, the collection itself
// (anchors locked in, greedy coverage fills around them), and any gaps with
// suggested games to fill them. Rendered from collection.json, produced by
// `python -m pipeline.collection --anchors "CATAN" --size 15`.
//
// Games in the list are multi-selectable: the radar draws the selection's
// combined coverage from the origin, or (in the "individual games" view) each
// game as its own overlaid polygon.
export default function Collection() {
  const [data, setData] = useState(null)
  const [missing, setMissing] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [mode, setMode] = useState('combined')

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}collection.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setMissing(true))
  }, [])

  if (missing) {
    return (
      <p className="loading">
        No collection built yet — run <code>python -m pipeline.collection --anchors "CATAN"</code>
      </p>
    )
  }
  if (!data) return <div className="loading">Loading collection…</div>

  const { meta, games, gaps } = data
  const hasAnchors = meta.anchors.length > 0
  const covered = data.fullCoverage.reduce((a, b) => a + b, 0)

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const baseLayers = [{ key: 'full', values: data.fullCoverage, className: 'radar__full' }]
  if (hasAnchors) baseLayers.push({ key: 'anchor', values: data.anchorCoverage, className: 'radar__anchor' })

  // Selected rows carry the same colour as their radar polygon in the
  // individual view; the combined view marks them all with the one
  // highlight colour its polygon uses.
  const rowColor = (index) => (mode === 'individual' ? gameColor(index) : 'var(--highlight)')

  return (
    <div className="collection">
      <div className="collection__radar">
        <CoverageRadar
          dimensions={meta.dimensions}
          baseLayers={baseLayers}
          games={games}
          selected={selected}
          mode={mode}
          onMode={setMode}
          idleCaption={
            <>
              {covered.toFixed(1)} of {meta.dimensions.length} axes covered ·{' '}
              {hasAnchors
                ? <>inner shape: anchors ({meta.anchors.join(', ')}) · outer: full collection</>
                : 'coverage of the built collection'}
            </>
          }
        />
      </div>

      <div className="collection__list">
        <h2>{meta.size} games</h2>
        <p className="muted collection__hint">Click games to chart them — select several to combine.</p>
        <ul>
          {games.map((g, i) => (
            <li key={g.id}
              className={`collection__row ${selected.has(g.id) ? 'is-highlit' : ''}`}
              style={selected.has(g.id) ? { boxShadow: `inset 3px 0 0 ${rowColor(i)}` } : undefined}
              onClick={() => toggle(g.id)}
              role="button" tabIndex={0} aria-pressed={selected.has(g.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.id) } }}>
              <div className="collection__game">
                <a href={g.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{g.name}</a>
                {g.anchored
                  ? <span className="badge badge--anchor">anchor</span>
                  : <span className="muted">+{g.gain.toFixed(2)} coverage</span>}
                <span className="detail__stats muted">
                  #{g.rank} · w{g.weight} · best {g.best_count}p
                </span>
              </div>
              {/* Unique contribution: how much total coverage would vanish if
                  this game left. A near-empty bar on an anchor means later
                  picks made it redundant — visible, not hidden. */}
              <div className="unique" title={`unique contribution ${g.uniqueContribution}`}>
                <div className="unique__bar" style={{ width: `${Math.min(g.uniqueContribution, 1) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="collection__gaps">
        <h2>Gaps</h2>
        {gaps.length === 0 ? (
          <p className="muted">None — every genre axis is at least half covered.</p>
        ) : (
          <ul>
            {gaps.map((gap) => (
              <li key={gap.dimension}>
                <strong>{gap.dimension.split(' / ')[0]}</strong>
                <span className="muted"> {(gap.coverage * 100).toFixed(0)}% covered — try </span>
                {gap.suggestions.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ', '}
                    <a href={`https://boardgamegeek.com/boardgame/${s.id}`} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
