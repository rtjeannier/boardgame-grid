import React, { useMemo, useRef, useState } from 'react'
import { toggleIn } from './settings.js'
import { parseCollectionCsv } from './importCsv.js'

// The reader's shelf: what they own, what they keep regardless, what they never
// want offered — and what the grid made of it.
//
// Owning a game is deliberately *not* pinning it. Pin the whole collection and
// the cut list is empty by construction: the grid agrees with whatever you
// already have and can tell you nothing. So owned games compete like any other,
// and only keepers are pinned.
export default function Shelf({ ix, result, settings, update }) {
  const [query, setQuery] = useState('')
  const [report, setReport] = useState(null)
  const file = useRef(null)

  const audit = useMemo(() => {
    if (!ix || !result) return null
    const shelved = new Map()
    for (const cell of result.data.cells) {
      for (const a of cell.assignments) shelved.set(a.game.id, { ...a.game, cell })
    }
    const owned = new Set(settings.owned)
    const keepers = new Set(settings.keepers)
    return {
      keepers: [...shelved.values()].filter((g) => keepers.has(g.id)),
      earned: [...shelved.values()].filter((g) => owned.has(g.id) && !keepers.has(g.id)),
      cut: [...owned].filter((id) => !shelved.has(id)),
      suggested: [...shelved.values()].filter((g) => !owned.has(g.id)),
    }
  }, [ix, result, settings.owned, settings.keepers])

  const matches = useMemo(() => {
    if (!ix || query.trim().length < 2) return []
    const q = query.trim().toLowerCase()
    const out = []
    for (let g = 0; g < ix.n && out.length < 12; g++) {
      if (ix.names[g].toLowerCase().includes(q)) out.push(g)
    }
    return out.sort((a, b) => ix.rank[a] - ix.rank[b])
  }, [ix, query])

  if (!ix) return <div className="loading">Loading…</div>
  const nameOf = (id) => ix.names[ix.rowOf.get(id)] ?? `#${id}`

  const onFile = async (e) => {
    const chosen = e.target.files?.[0]
    if (!chosen) return
    const parsed = parseCollectionCsv(await chosen.text(), ix)
    setReport(parsed)
    update((prev) => ({ owned: [...new Set([...prev.owned, ...parsed.matched])] }))
    e.target.value = ''
  }

  return (
    <div className="shelf">
      <section className="shelf__panel">
        <h2>Bring your collection in</h2>
        <p className="muted">
          Export your collection from BoardGameGeek as CSV and drop it here.
          Matching is by BGG id, so nothing hinges on how a game is spelled.
        </p>
        <div className="shelf__actions">
          <button onClick={() => file.current?.click()}>Upload a BGG CSV</button>
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          {settings.owned.length > 0 && (
            <button className="link" onClick={() => update({ owned: [], keepers: [] })}>
              Clear {settings.owned.length} games
            </button>
          )}
        </div>
        {report && <ImportReport report={report} />}

        <label className="shelf__search">
          <span>Or add one at a time</span>
          <input value={query} placeholder="Search 5,000 games…"
            onChange={(e) => setQuery(e.target.value)} />
        </label>
        {matches.length > 0 && (
          <ul className="shelf__matches">
            {matches.map((g) => {
              const id = ix.ids[g]
              const have = settings.owned.includes(id)
              return (
                <li key={id}>
                  <span>{ix.names[g]} <span className="muted">#{ix.rank[g]}</span></span>
                  <button onClick={() => update(toggleIn(settings, 'owned', id))}>
                    {have ? 'Remove' : 'Add'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {audit && settings.owned.length > 0 && (
        <section className="shelf__panel">
          <h2>What the grid made of it</h2>
          <p className="muted">
            {audit.keepers.length} kept · {audit.earned.length} earned their slot ·{' '}
            {audit.cut.length} cut · {audit.suggested.length} suggested
          </p>

          <Group title="Earned their slot"
            note="These beat everything else for a cell they reach."
            games={audit.earned} settings={settings} update={update} ix={ix} />

          <Group title="Kept regardless"
            note="Pinned, whatever the maths says."
            games={audit.keepers} settings={settings} update={update} ix={ix} />

          <div className="shelf__group">
            <h3>Cut <span className="muted">({audit.cut.length})</span></h3>
            <p className="muted">
              You own these and something else won every cell they reach. Often
              that is a second edition, or a game a near-neighbour already covers.
            </p>
            <ul className="shelf__list">
              {audit.cut.map((id) => (
                <li key={id}>
                  <span>{nameOf(id)}</span>
                  <span className="shelf__row-actions">
                    <button onClick={() => update(toggleIn(settings, 'keepers', id))}>
                      Keep anyway
                    </button>
                    <button onClick={() => update(toggleIn(settings, 'owned', id))}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {settings.banned.length > 0 && (
        <section className="shelf__panel">
          <h2>Never suggest <span className="muted">({settings.banned.length})</span></h2>
          <ul className="shelf__list">
            {settings.banned.map((id) => (
              <li key={id}>
                <span>{nameOf(id)}</span>
                <button onClick={() => update(toggleIn(settings, 'banned', id))}>
                  Allow again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Group({ title, note, games, settings, update, ix }) {
  if (!games.length) return null
  return (
    <div className="shelf__group">
      <h3>{title} <span className="muted">({games.length})</span></h3>
      <p className="muted">{note}</p>
      <ul className="shelf__list">
        {games.map((g) => (
          <li key={g.id}>
            <span>{g.name} <span className="muted">#{g.rank}</span></span>
            <span className="shelf__row-actions">
              <button onClick={() => update(toggleIn(settings, 'keepers', g.id))}>
                {settings.keepers.includes(g.id) ? 'Unpin' : 'Keep'}
              </button>
              <button onClick={() => update(toggleIn(settings, 'owned', g.id))}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// A working import produces unmatched rows, so counting them alone reads as a
// failure. Expansions are excluded from the corpus by construction — BGG ranks
// them separately — so a shelf of forty games and thirty expansions leaves
// thirty rows unmatched with nothing wrong.
function ImportReport({ report }) {
  return (
    <div className="shelf__report">
      <strong>Imported {report.matched.length} of {report.rows} rows.</strong>
      {report.expansions > 0 && (
        <p className="muted">{report.expansions} look like expansions — the grid
          shelves base games only.</p>
      )}
      {report.unmatched.length > 0 && (
        <details>
          <summary>{report.unmatched.length} not in the top 5,000</summary>
          <ul>{report.unmatched.slice(0, 40).map((r) => <li key={r.id}>{r.name}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
