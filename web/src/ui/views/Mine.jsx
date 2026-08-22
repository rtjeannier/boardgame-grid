import { useMemo, useState } from 'react';
import * as engine from '../../engine/index.js';
import Button from '../primitives/Button.jsx';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import { parseCollectionCsv } from '../importCsv.js';
import { Search } from '../icons.jsx';
import { whyCut } from './labels.js';
import { shelvedNow } from './Board.jsx';
import css from './Mine.module.css';

/**
 * The games you own, and what became of each.
 *
 * Two ways in, because the two that work offline are the two that matter: find
 * one by name, or paste a list you already have. Pulling a BGG username is a
 * later job and is not pretended at here.
 */

function matches(ix, query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (let r = 0; r < ix.n; r++) {
    if (ix.names[r].toLowerCase().includes(q)) out.push(r);
    if (out.length > 400) break;
  }
  return out.sort((a, b) => ix.rank[a] - ix.rank[b]).slice(0, limit);
}

/** Names to rows, case- and punctuation-insensitively. Reports what it missed. */
function matchList(ix, text) {
  const tidy = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byName = new Map();
  for (let r = 0; r < ix.n; r++) byName.set(tidy(ix.names[r]), r);
  const found = [];
  const missed = [];
  for (const line of text.split(/[\n\r]+/)) {
    const name = line.split(/[,;\t]/)[0].trim();
    if (!name) continue;
    const row = byName.get(tidy(name));
    if (row === undefined) missed.push(name);
    else found.push(ix.ids[row]);
  }
  return { found: [...new Set(found)], missed };
}

export default function Mine({ built, state, actions, onOpen }) {
  const { ix, grid } = built;
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState('all');

  const results = useMemo(() => matches(ix, query), [ix, query]);
  const shelved = useMemo(
    () => new Set(grid.flatMap((c) => c.picks.map((p) => p.id))), [grid]);

  const held = new Map();
  for (const cell of grid) for (const p of cell.picks) held.set(p.id, cell.key);

  const mine = useMemo(() => state.owned.map((id) => {
    const row = ix.rowOf.get(id);
    if (row === undefined) return null;
    const holds = shelved.has(id);
    return toGameView(ix, row, {
      owned: true,
      pinned: state.pinned.includes(id),
      blocked: state.blocked.includes(id),
      reason: holds ? null : whyCut(built, engine, row),
      shelf: held.get(id) ?? null,
    });
  }).filter(Boolean), [built, ix, state.owned, state.pinned, state.blocked, shelved]);

  const holds = mine.filter((g) => shelved.has(g.id));
  const lost = mine.filter((g) => !shelved.has(g.id));
  const shown = filter === 'holds' ? holds : filter === 'lost' ? lost : mine;

  return (
    <div className={css.view}>
      <aside className={css.side}>
        <div className={css.block}>
          <h2 className={css.label}>Add one at a time</h2>
          <div className={css.search}>
            <span className={css.icon}><Search /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder={`Search ${ix.n.toLocaleString()} games`}
                   aria-label="Search for a game" />
          </div>
          {results.length > 0 && (
            <div className={css.results}>
              {results.map((r) => {
                const have = state.owned.includes(ix.ids[r]);
                return (
                  <button key={ix.ids[r]} type="button" className={css.result}
                          onClick={() => { actions.own(ix.ids[r]); setQuery(''); }}>
                    <span className={css.rname}>{ix.names[r]}</span>
                    <span className={css.rmeta}>#{ix.rank[r]}</span>
                    <span className={`${css.radd} ${have ? css.have : ''}`.trim()}>
                      {have ? 'Remove' : 'Add'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className={css.note}>Click the game, not a button beside it.</p>
        </div>

        <div className={css.block}>
          <h2 className={css.label}>Or paste a list</h2>
          <textarea className={css.paste} value={text} rows={5}
                    onChange={(e) => setText(e.target.value)}
                    aria-label="Paste a list of games"
                    placeholder="One game per line, or a BoardGameGeek CSV export pasted whole. Anything that cannot be placed is reported rather than dropped." />
          <div className={css.row}>
            <Button onClick={() => {
              // A BoardGameGeek export is keyed on `objectid`, which survives
              // re-spellings and edition changes; a hand-written list is not, so
              // it falls back to matching names. Whichever it is, what could not
              // be placed is reported rather than dropped.
              const csv = /objectid/i.test(text.split(/[\n\r]/)[0] ?? '')
                ? parseCollectionCsv(text, ix) : null;
              if (csv) {
                actions.ownMany(csv.matched);
                setReport({
                  found: csv.matched.length,
                  missed: csv.unmatched.map((u) => u.name),
                  expansions: csv.expansions,
                });
                if (!csv.unmatched.length) setText('');
                return;
              }
              const { found, missed } = matchList(ix, text);
              actions.ownMany(found);
              setReport({ found: found.length, missed });
              if (!missed.length) setText('');
            }}>Add these</Button>
            <span className={css.later}>A BGG username comes later.</span>
          </div>
          {report && (
            <p className={css.note}>
              Added {report.found}.
              {report.expansions ? ` ${report.expansions} expansions skipped — the corpus ranks those separately.` : ''}
              {report.missed.length
                ? ` Could not place ${report.missed.length}: ${report.missed.slice(0, 3).join(', ')}${report.missed.length > 3 ? '…' : ''}`
                : ''}
            </p>
          )}
        </div>
      </aside>

      <div className={css.main}>
        <div className={css.head}>
          <h2 className={css.title}>What happened to each</h2>
          <span className={css.filters}>
            {[['all', `All ${mine.length}`], ['holds', `Hold a place ${holds.length}`],
              ['lost', `Did not ${lost.length}`]].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                      className={`${css.filter} ${filter === key ? css.on : ''}`.trim()}>
                {label}
              </button>
            ))}
          </span>
        </div>

        {mine.length === 0 ? (
          <p className={css.blank}>
            Nothing yet. The collection on the left is what the model would build
            with no help from you — add what you own and it fills around them
            instead, and this page will say which of yours held a place and which
            lost the shelf they reach.
          </p>
        ) : (
          <div className={css.list}>
            {shown.map((game) => (
              <div key={game.id} className={css.entry}>
                <GameItem game={game} variant={game.reason ? 'reason' : 'row'}
                          onOpen={onOpen}
                          onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                          onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
