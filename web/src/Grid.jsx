import React from 'react'
import { colorFor } from './colors.js'
import { primary } from './genres.js'

// The grid itself: player count across the top, complexity down the side.
// Rows are drawn heaviest-first so complexity rises as you scan upward.
export default function Grid({ data, active, selected, onSelect, owned = new Set() }) {
  const { playerColumns, weightRows, genreDimensions } = data.meta
  const rowsTopDown = [...weightRows].reverse()

  // Fast lookup from (column, row) to its cell payload.
  const byKey = new Map(data.cells.map((c) => [`${c.column}:${c.row}`, c]))

  // One header column for the row labels, then one per player count.
  const template = `minmax(6.5rem, auto) repeat(${playerColumns.length}, minmax(9rem, 1fr))`

  return (
    <div className="grid-scroll">
      <div className="grid" style={{ gridTemplateColumns: template }}>
        <div className="grid__corner">
          <span>weight ↑</span>
          <span>players →</span>
        </div>
        {playerColumns.map((label) => (
          <div key={label} className="grid__colhead">
            {label}
          </div>
        ))}

        {rowsTopDown.map((row) => (
          <React.Fragment key={row.index}>
            <div className="grid__rowhead">
              <strong>{row.name}</strong>
              <span className="muted">{row.lo}–{row.hi}</span>
            </div>
            {playerColumns.map((col) => {
              const cell = byKey.get(`${col}:${row.index}`)
              const isSelected = selected && selected.column === col && selected.row === row.index
              return (
                <Cell
                  key={col}
                  cell={cell}
                  owned={owned}
                  genres={genreDimensions}
                  active={active}
                  selected={isSelected}
                  onSelect={() => cell && onSelect({ column: col, row: row.index })}
                />
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function Cell({ cell, genres, active, selected, onSelect, owned }) {
  if (!cell) return <div className="cell cell--empty" />

  const extra = cell.candidateCount - cell.assignments.length
  const mine = cell.assignments.filter(({ game }) => owned.has(game.id)).length
  // Once a shelf is loaded, what a cell is missing matters more than what it
  // holds: the gap is how many of its slots hold nothing the reader owns.
  const gap = owned.size ? cell.assignments.length - mine : 0

  return (
    <button className={`cell ${selected ? 'cell--selected' : ''}`} onClick={onSelect}>
      {cell.assignments.map(({ game }) => {
        const dim = active.size > 0 && !active.has(game.genre)
        const have = owned.has(game.id)
        return (
          <span key={game.id}
            className={`pick ${dim ? 'pick--dim' : ''} ${have ? 'pick--owned' : ''}`}
            title={`${primary(game.genre ?? '—')} · weight ${game.weight}` +
              (have ? ' · on your shelf' : '')}>
            <span className="dot" style={{ background: colorFor(game.genre, genres) }} />
            <span className="pick__name">{game.name}</span>
          </span>
        )
      })}
      <span className="cell__foot">
        {owned.size > 0 && (
          <span className={`cell__gap ${gap === 0 ? 'cell__gap--full' : ''}`}>
            {gap === 0 ? 'all yours' : `${gap} to fill`}
          </span>
        )}
        {extra > 0 && <span className="cell__more">+{extra} more</span>}
      </span>
    </button>
  )
}
