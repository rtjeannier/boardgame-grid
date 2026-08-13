import React, { useEffect, useState } from 'react'
import Radar from './Radar.jsx'

// The Collection tab: a radar chart of genre coverage, the collection itself
// (anchors locked in, greedy coverage fills around them), and any gaps with
// suggested games to fill them. Rendered from collection.json, produced by
// `python -m pipeline.collection --anchors "CATAN" --size 15`.
export default function Collection() {
  const [data, setData] = useState(null)
  const [missing, setMissing] = useState(false)

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

  return (
    <div className="collection">
      <div className="collection__radar">
        <Radar
          dimensions={meta.dimensions}
          anchorCoverage={data.anchorCoverage}
          fullCoverage={data.fullCoverage}
          hasAnchors={hasAnchors}
        />
        <p className="muted collection__caption">
          {covered.toFixed(1)} of {meta.dimensions.length} axes covered ·{' '}
          {hasAnchors
            ? <>inner shape: anchors ({meta.anchors.join(', ')}) · outer: full collection</>
            : 'coverage of the built collection'}
        </p>
      </div>

      <div className="collection__list">
        <h2>{meta.size} games</h2>
        <ul>
          {games.map((g) => (
            <li key={g.id}>
              <div className="collection__game">
                <a href={g.url} target="_blank" rel="noreferrer">{g.name}</a>
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
