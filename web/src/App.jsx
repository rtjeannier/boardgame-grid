import React, { useEffect, useState } from 'react'
import Grid from './Grid.jsx'
import Detail from './Detail.jsx'
import { colorFor } from './colors.js'

// Top-level app: load the generated grid, hold the two pieces of UI state
// (which archetypes are highlighted, which cell is open) and lay out the page.
export default function App() {
  const [data, setData] = useState(null)
  const [active, setActive] = useState(() => new Set()) // empty = show everything
  const [selected, setSelected] = useState(null)        // {column, row} or null

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}grid.json`)
      .then((r) => r.json())
      .then(setData)
  }, [])

  if (!data) return <div className="loading">Loading grid…</div>

  const toggle = (label) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })

  const selectedCell =
    selected && data.cells.find((c) => c.column === selected.column && c.row === selected.row)

  return (
    <div className="app">
      <Header meta={data.meta} />
      <Legend archetypes={data.meta.archetypes} active={active} onToggle={toggle} />
      <Grid data={data} active={active} selected={selected} onSelect={setSelected} />
      {selectedCell && (
        <Detail
          cell={selectedCell}
          meta={data.meta}
          active={active}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function Header({ meta }) {
  return (
    <header className="header">
      <h1>Board Game Grid</h1>
      <p className="subtitle">
        Best game of each type at every player count &amp; complexity.
        <span className={`badge badge--${meta.source}`}>{meta.source} data</span>
        <span className="muted">
          {meta.gameCount} games · generated {meta.generatedAt.slice(0, 10)}
        </span>
      </p>
    </header>
  )
}

// Clickable archetype swatches. Selecting some dims everything else in the grid
// so you can trace, say, every worker-placement pick across the board.
function Legend({ archetypes, active, onToggle }) {
  return (
    <div className="legend">
      {archetypes.map((label) => {
        const on = active.size === 0 || active.has(label)
        return (
          <button
            key={label}
            className={`legend__item ${on ? '' : 'legend__item--off'}`}
            onClick={() => onToggle(label)}
          >
            <span className="dot" style={{ background: colorFor(label) }} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
