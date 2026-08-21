import React, { useState } from 'react'
import Grid from './Grid.jsx'
import Detail from './Detail.jsx'
import Shelf from './Shelf.jsx'
import Controls from './Controls.jsx'
import { colorFor } from './colors.js'
import { primary } from './genres.js'
import { useSettings, toggleIn } from './settings.js'
import { useGrid } from './useGrid.js'

// Top-level app. The grid is no longer a file being displayed — it is computed
// here, from the contract, every time the reader changes something. What comes
// out of the engine is shaped exactly like the JSON the views used to read, so
// the rendering below is unchanged by any of it.
export default function App() {
  const [settings, update, reset] = useSettings()
  const { ix, result, error, ms } = useGrid(settings)
  const [tab, setTab] = useState('grid')
  const [active, setActive] = useState(() => new Set())
  const [selected, setSelected] = useState(null)

  if (error) {
    return (
      <div className="loading">
        <p>Could not load the grid: {error}</p>
        <p className="muted">Build it with <code>python -m pipeline.build --contract</code>.</p>
      </div>
    )
  }
  if (!result) return <div className="loading">Loading grid…</div>

  const data = result.data
  const toggle = (label) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })

  const selectedCell =
    selected && data.cells.find((c) => c.column === selected.column && c.row === selected.row)

  const ban = (id) => {
    update(toggleIn(settings, 'banned', id))
    setSelected(null)
  }

  return (
    <div className="app">
      <Header meta={data.meta} settings={settings} />
      <nav className="tabs">
        {[['grid', 'Grid'], ['shelf', `Your shelf${settings.owned.length ? ` (${settings.owned.length})` : ''}`]]
          .map(([key, label]) => (
            <button key={key}
              className={`tabs__tab ${tab === key ? 'tabs__tab--on' : ''}`}
              onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
      </nav>

      <Controls settings={settings} update={update} reset={reset}
        genres={data.meta.genreDimensions} ms={ms} />

      {tab === 'grid' ? (
        <>
          <Legend genres={data.meta.genreDimensions} active={active} onToggle={toggle} />
          <Grid data={data} active={active} selected={selected} onSelect={setSelected}
            owned={new Set(settings.owned)} />
          {selectedCell && (
            <Detail
              cell={selectedCell}
              meta={data.meta}
              active={active}
              owned={new Set(settings.owned)}
              onBan={ban}
              onOwn={(id) => update(toggleIn(settings, 'owned', id))}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      ) : (
        <Shelf ix={ix} result={result} settings={settings} update={update} />
      )}
    </div>
  )
}

function Header({ meta, settings }) {
  const tuned = settings.owned.length || settings.banned.length
    || Object.keys(settings.genreWeights).length
  return (
    <header className="header">
      <h1>Board Game Grid</h1>
      <p className="subtitle">
        Best game of each type at every player count &amp; complexity.
        <span className="badge badge--live">{meta.gameCount} games</span>
        {tuned ? <span className="muted">tuned to your shelf · this page&rsquo;s URL carries it</span>
          : <span className="muted">generated {meta.generatedAt.slice(0, 10)}</span>}
      </p>
    </header>
  )
}

// Clickable genre swatches, one per radar spoke. Selecting some dims everything
// else so you can trace, say, every dexterity pick across the board.
function Legend({ genres, active, onToggle }) {
  return (
    <div className="legend">
      {genres.map((label) => {
        const on = active.size === 0 || active.has(label)
        return (
          <button key={label}
            className={`legend__item ${on ? '' : 'legend__item--off'}`}
            onClick={() => onToggle(label)} title={label}>
            <span className="dot" style={{ background: colorFor(label, genres) }} />
            {primary(label)}
          </button>
        )
      })}
    </div>
  )
}
