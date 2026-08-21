import React, { useState } from 'react'
import { DEFAULT_COLUMNS } from './settings.js'
import { primary } from './genres.js'
import { colorFor } from './colors.js'

// The reader's settings, all of them. Nothing here is a model hyperparameter:
// those are fitted once, live in the contract's `policy`, and are applied
// without ever being shown. What a person can reason about is the shape of the
// grid and which kinds of game they want it to reach for.
export default function Controls({ settings, update, reset, genres, ms }) {
  const [open, setOpen] = useState(false)

  return (
    <aside className={`controls ${open ? 'controls--open' : ''}`}>
      <button className="controls__toggle" onClick={() => setOpen(!open)}
        aria-expanded={open}>
        {open ? '✕ Close' : '⚙ Tune the grid'}
        {ms ? <span className="muted"> · {ms}ms</span> : null}
      </button>

      {open && (
        <div className="controls__body">
          <Section title="Shelves">
            <Slider label="Games per cell" value={settings.picksPerCell}
              min={1} max={10}
              onChange={(v) => update({ picksPerCell: v })} />
            <Slider label="Complexity rows" value={settings.rowCount}
              min={2} max={6}
              onChange={(v) => update({ rowCount: v })} />
            <p className="controls__note">
              Rows are quantiles of the population, so each holds a comparable
              number of games whatever you pick.
            </p>
          </Section>

          <Section title="Depth per column">
            <p className="controls__note">
              The player columns are fixed ranges over a lopsided distribution —
              far fewer games play well at nine than at four — so the same five
              slots mean different things across the grid.
            </p>
            {settings.columns.map((col) => (
              <Slider key={col.label} label={`${col.label} players`}
                value={settings.picksPerColumn[col.label] ?? settings.picksPerCell}
                min={0} max={10}
                onChange={(v) => update((prev) => {
                  const next = { ...prev.picksPerColumn }
                  if (v >= prev.picksPerCell) delete next[col.label]
                  else next[col.label] = v
                  return { picksPerColumn: next }
                })} />
            ))}
            <label className="controls__check">
              <input type="checkbox" checked={settings.gainFloor !== null}
                onChange={(e) => update({ gainFloor: e.target.checked ? 0.15 : null })} />
              <span>Or let thin cells stop on their own</span>
            </label>
            {settings.gainFloor !== null && (
              <Slider label="How much a game must add" value={settings.gainFloor}
                min={0} max={0.5} step={0.01}
                onChange={(v) => update({ gainFloor: v })} />
            )}
          </Section>

          <Section title="Player columns">
            <ColumnEditor columns={settings.columns}
              onChange={(columns) => update({ columns })} />
          </Section>

          <Section title="Kinds you play">
            <p className="controls__note">
              Turning a kind down shortens its spoke: a game filling it fills
              less space. At zero it offers nothing — though a game with a foot
              in another kind can still earn its slot there.
            </p>
            {genres.map((name, i) => (
              <Slider key={name} label={primary(name)} swatch={colorFor(name, genres)}
                value={settings.genreWeights[i] ?? 1} min={0} max={2} step={0.1}
                onChange={(v) => update((prev) => {
                  const next = { ...prev.genreWeights }
                  if (v === 1) delete next[i]; else next[i] = v
                  return { genreWeights: next }
                })} />
            ))}
          </Section>

          <button className="controls__reset" onClick={reset}>Reset everything</button>
        </div>
      )}
    </aside>
  )
}

function Section({ title, children }) {
  return (
    <section className="controls__section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, swatch }) {
  return (
    <label className="controls__slider">
      <span className="controls__label">
        {swatch && <i className="dot" style={{ background: swatch }} />}
        {label}
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
      <output>{value}</output>
    </label>
  )
}

// Columns are ranges over player counts, kept disjoint so eight sits in one
// column and only nine-plus in the next. `hi: null` is open-ended.
function ColumnEditor({ columns, onChange }) {
  const set = (i, patch) =>
    onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="coledit">
      {columns.map((col, i) => (
        <div key={i} className="coledit__row">
          <input className="coledit__label" value={col.label} aria-label="label"
            onChange={(e) => set(i, { label: e.target.value })} />
          <input className="coledit__num" type="number" min={1} value={col.lo}
            aria-label="from" onChange={(e) => set(i, { lo: Number(e.target.value) })} />
          <span className="muted">–</span>
          <input className="coledit__num" type="number" min={0} value={col.hi ?? ''}
            placeholder="∞" aria-label="to"
            onChange={(e) => set(i, { hi: e.target.value === '' ? null : Number(e.target.value) })} />
          <button className="coledit__drop" aria-label={`remove ${col.label}`}
            onClick={() => onChange(columns.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="coledit__actions">
        <button onClick={() => onChange([...columns,
          { label: `${(columns.at(-1)?.hi ?? 9) + 1}+`, lo: (columns.at(-1)?.hi ?? 9) + 1, hi: null }])}>
          + Add column
        </button>
        <button onClick={() => onChange(DEFAULT_COLUMNS)}>Reset columns</button>
      </div>
    </div>
  )
}
