import React, { useMemo, useRef, useState } from 'react'
import { toggleIn } from './settings.js'
import { parseCollectionCsv } from './importCsv.js'
import { cutSentence, explainCut } from './engine/explain.js'
import { analyseShelf } from './engine/shelf.js'
import CoverageRadar from './CoverageRadar.jsx'

// The reader's shelf: what they own, what they keep regardless, what they never
// want offered — and what the grid made of it.
//
// Owning a game is deliberately *not* pinning it. Pin the whole collection and
// the cut list is empty by construction: the grid agrees with whatever you
// already have and can tell you nothing. So owned games compete like any other,
// and only keepers are pinned.
export default function Shelf({ ix, result, settings, update }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('combined')
  const [spotlit, setSpotlit] = useState(() => new Set())
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

    // Why a game was cut, per game, rather than one guess covering all of them.
    const rows = new Set([...shelved.keys()].map((id) => ix.rowOf.get(id)))
    const picksByCell = new Map(result.data.cells.map((c) => [
      `${c.column}|${c.row}`, c.assignments.map((a) => ix.rowOf.get(a.game.id)),
    ]))
    const label = (key) => {
      const [column, row] = key.split('|')
      const name = result.rows.find((r) => String(r.index) === row)?.name ?? row
      return `${column} players · ${name}`
    }
    const cut = [...owned].filter((id) => !shelved.has(id)).map((id) => {
      const g = ix.rowOf.get(id)
      if (g === undefined) return { id, name: `#${id}`, why: 'Not in this corpus.' }
      return {
        id, name: ix.names[g], rank: ix.rank[g],
        why: cutSentence(explainCut(ix, g, rows, result.cells, picksByCell), label),
      }
    })

    return {
      keepers: [...shelved.values()].filter((g) => keepers.has(g.id)),
      earned: [...shelved.values()].filter((g) => owned.has(g.id) && !keepers.has(g.id)),
      cut,
      suggested: [...shelved.values()].filter((g) => !owned.has(g.id)),
    }
  }, [ix, result, settings.owned, settings.keepers])

  // The other question the grid does not answer: across everything you own,
  // what kinds are you covered for? No cell membership here — a shelf is not
  // played at one player count.
  const analysis = useMemo(() => {
    if (!ix || !result || !settings.owned.length) return null
    const rows = new Set(settings.owned.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined))
    return analyseShelf(ix, result.weights, rows, {
      bannedRows: new Set(settings.banned.map((id) => ix.rowOf.get(id))),
    })
  }, [ix, result, settings.owned, settings.banned])

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
        {query.trim().length >= 2 && (
          matches.length > 0 ? (
            <ul className="results" role="listbox">
              {matches.map((g) => {
                const id = ix.ids[g]
                const have = settings.owned.includes(id)
                return (
                  <li key={id}>
                    {/* The whole row is the control. A separate "Add" button
                        makes the obvious gesture — clicking the game — do
                        nothing, which reads as the list being broken. */}
                    <button className={`results__row ${have ? 'is-on' : ''}`}
                      role="option" aria-selected={have}
                      onClick={() => update(toggleIn(settings, 'owned', id))}>
                      <span className="results__tick" aria-hidden="true">
                        {have ? '\u2713' : '+'}
                      </span>
                      <span className="results__name">{ix.names[g]}</span>
                      <span className="results__meta">
                        #{ix.rank[g]} · {ix.year[g]}
                      </span>
                      <span className="results__state">
                        {have ? 'on your shelf' : 'add'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="results__none muted">
              Nothing matching &ldquo;{query.trim()}&rdquo; in the top 5,000.
            </p>
          )
        )}
      </section>

      {analysis && (
        <section className="shelf__panel">
          <h2>What your shelf covers</h2>
          <p className="muted">
            {analysis.total} of {analysis.spokes} kinds covered.
            A kind counts as covered when some game you own is a strong example
            of it — so twelve mediocre card games still leave the card spoke short.
          </p>
          <CoverageRadar
            dimensions={ix.groups.map((g) => g.name)}
            games={analysis.unique}
            baseIds={new Set(analysis.unique.map((g) => g.id))}
            selected={spotlit} mode={mode} onMode={setMode}
            idleCaption="Click a game below to see what it alone contributes" />

          <div className="shelf__group">
            <h3>Pulling the least weight</h3>
            <p className="muted">
              How much coverage would vanish without each game. An excellent game
              surrounded by near-neighbours contributes almost nothing — which is
              the point of the number, not a criticism of the game.
            </p>
            <ul className="shelf__list">
              {analysis.unique.slice(0, 6).map((g) => (
                <li key={g.id}>
                  <button className="shelf__spot"
                    onClick={() => setSpotlit((prev) => {
                      const next = new Set(prev)
                      next.has(g.id) ? next.delete(g.id) : next.add(g.id)
                      return next
                    })}>
                    {g.name} <span className="muted">#{g.rank}</span>
                  </button>
                  <span className="muted">{g.unique.toFixed(2)} unique</span>
                </li>
              ))}
            </ul>
          </div>

          {analysis.gaps.length > 0 && (
            <div className="shelf__group">
              <h3>Thin on <span className="muted">({analysis.gaps.length})</span></h3>
              <ul className="shelf__list shelf__list--reasons">
                {analysis.gaps.map((gap) => (
                  <li key={gap.group}>
                    <span className="shelf__why">
                      <span>{gap.name.split(' · ')[0]}
                        <span className="muted"> · {Math.round(gap.coverage * 100)}% covered</span>
                      </span>
                      <em>Would fill it: {gap.suggestions.map((s) => s.name).join(', ')}</em>
                    </span>
                    <span className="shelf__row-actions">
                      {gap.suggestions.slice(0, 1).map((s) => (
                        <button key={s.id}
                          onClick={() => update(toggleIn(settings, 'owned', s.id))}>
                          + {s.name.slice(0, 18)}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

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
            <h3>Not shelved <span className="muted">({audit.cut.length})</span></h3>
            <p className="muted">
              You own these and the grid did not find room. The reason is given
              per game rather than guessed at — pin one and it goes on anyway.
            </p>
            <ul className="shelf__list shelf__list--reasons">
              {audit.cut.map((g) => (
                <li key={g.id}>
                  <span className="shelf__why">
                    <span>{g.name} {g.rank ? <span className="muted">#{g.rank}</span> : null}</span>
                    <em>{g.why}</em>
                  </span>
                  <span className="shelf__row-actions">
                    <button onClick={() => update(toggleIn(settings, 'keepers', g.id))}>
                      Keep anyway
                    </button>
                    <button onClick={() => update(toggleIn(settings, 'owned', g.id))}>
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
