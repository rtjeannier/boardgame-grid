import { useMemo } from 'react';
import { coverageOf, redundancies, spokeVector } from '../../engine/index.js';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import Radar from '../chart/Radar.jsx';
import Button from '../primitives/Button.jsx';
import DepthField from '../primitives/DepthField.jsx';
import { sharesOf } from '../state.js';
import Board, { shelvedNow } from './Board.jsx';
import { cellLabeller } from './labels.js';
import css from './Collection.module.css';

/**
 * The collection, however it happens to be cut.
 *
 * With no axes there is one shelf and it is worth reading in full, so this is a
 * register: every game, what it does, and how much of the whole it carries.
 * Split it and the register gives way to `Board`, because thirty-five shelves
 * of five are a shape rather than a list.
 */

/**
 * The one game it would take next, wherever that is.
 *
 * Unsplit there is one shelf and one answer. Split, every shelf has a next in
 * line and the useful one is whichever would add the most — so the button names
 * that game and says which shelf it lands on. It is the same question either
 * way, which is the point: splitting rearranges the collection, it does not
 * change what you can ask of it.
 */
function AddNext({ built, actions }) {
  const { grid, depths, axes } = built;
  const label = cellLabeller(built);

  const best = axes.length === 0
    ? (depths?.cell?.nextName
      ? { name: depths.cell.nextName, gain: depths.cell.next,
          key: 'collection', depth: depths.cell.depth, cell: null }
      : null)
    : grid
      .flatMap((c) => (c.alternates[0]
        ? [{ name: c.alternates[0].name, gain: c.alternates[0].gain,
             key: `cell:${c.key}`, depth: c.picks.length, cell: c.key }]
        : []))
      .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))[0];
  if (!best) return null;

  const last = axes.length === 0
    ? (grid[0]?.picks?.length ? grid[0].picks[grid[0].picks.length - 1].gain : null)
    : (grid.find((c) => c.key === best.cell)?.gains?.slice(-1)[0] ?? null);

  return (
    <div className={css.addRow}>
      <Button onClick={() => actions.setDepth(best.key, best.depth + 1)}>
        ＋ Add {best.name}
      </Button>
      <span className={css.addNote}>
        {best.cell ? `Goes on ${label(best.cell)}. ` : ''}
        {last == null
          ? `Adds ${best.gain?.toFixed(2)} — the most of anything left.`
          : `Adds ${best.gain?.toFixed(2)}, against ${last.toFixed(2)} for the last one in.`}
      </span>
    </div>
  );
}

/**
 * Games the collection is holding twice.
 *
 * The question is not "which of yours contributes least" — with two games it
 * contributes all of it, and the answer was nonsense. It is "whose role is
 * already filled by another game", which is containment of one profile in
 * another, and which correctly returns nothing at all when nothing is
 * duplicated.
 */
function AlreadyFilled({ built, state, actions, onOpen }) {
  const { ix, weights, grid } = built;
  const floor = ix.defaults?.redundancyFloor ?? 0.9;

  const found = useMemo(() => {
    const rows = grid.flatMap((c) => c.picks.map((p) => ix.rowOf.get(p.id)))
      .filter((r) => r !== undefined);
    if (rows.length < 2) return [];
    // Where each one sits, so the row can say what takes its place.
    const home = new Map();
    for (const cell of grid) for (const p of cell.picks) home.set(p.id, cell);
    return redundancies(ix, weights, rows, { floor }).map((r) => ({
      ...r,
      mine: state.owned.includes(r.id),
      instead: home.get(r.id)?.alternates?.[0]?.name ?? null,
    })).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
  }, [ix, weights, grid, floor, state.owned]);

  if (!found.length) return null;
  return (
    <div className={css.block}>
      <h2 className={css.label}>Held twice</h2>
      <div className={css.list}>
        {found.map((r) => (
          <div key={r.id} className={css.entry}>
            <GameItem
              variant="reason"
              game={toGameView(ix, r.row, {
                owned: r.mine,
                pinned: state.pinned.includes(r.id),
                blocked: state.blocked.includes(r.id),
                reason: `${r.filledBy.name} already covers ${Math.round(r.share * 100)}%`
                  + ` of what it brings.${r.instead ? ` Drop it and ${r.instead} comes in.` : ''}`,
              })}
              onOpen={onOpen}
              onPin={(x) => actions.pin(x.id, shelvedNow(built), x.name)}
              onBlock={(x) => actions.block(x.id, shelvedNow(built), x.name)} />
          </div>
        ))}
      </div>
      <p className={css.note}>
        How much of a game's own profile another single game already covers.
        Yours first. Nothing here means nothing is duplicated.
      </p>
    </div>
  );
}

function Facts({ ix, rows }) {
  const players = (lo, hi) => rows.filter((r) => {
    for (let k = ix.playerFit.start[r]; k < ix.playerFit.start[r + 1]; k++) {
      const c = ix.playerFit.idx[k];
      if (ix.playerFit.val[k] >= 0.999 && c >= lo && (hi == null || c <= hi)) return true;
    }
    return false;
  }).length;
  const times = rows.map((r) => ix.playtime[r]).sort((a, b) => a - b);
  const weights = rows.map((r) => ix.weight[r]).sort((a, b) => a - b);
  const ranks = rows.map((r) => ix.rank[r]).sort((a, b) => a - b);
  const hours = (m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${m}m`);
  const facts = [
    ['Plays alone', players(1, 1)],
    ['Plays at two', players(2, 2)],
    ['Takes eight or more', players(8, null)],
    ['Shortest', hours(times[0] ?? 0)],
    ['Longest', hours(times[times.length - 1] ?? 0)],
    ['Weight', `${(weights[0] ?? 0).toFixed(1)} – ${(weights[weights.length - 1] ?? 0).toFixed(1)}`],
    ['Best known', `#${ranks[0] ?? 0}`],
    ['Least known', `#${(ranks[ranks.length - 1] ?? 0).toLocaleString()}`],
  ];
  return (
    <div className={css.facts}>
      {facts.map(([label, value]) => (
        <span key={label} className={css.fact}><span>{label}</span><b>{value}</b></span>
      ))}
    </div>
  );
}

function Why({ cell }) {
  if (!cell?.curve?.length) return null;
  const top = Math.max(...cell.curve);
  const before = cell.depth > 0 ? cell.curve[cell.depth - 1] : null;
  const after = cell.curve[cell.depth] ?? null;
  return (
    <div className={css.block}>
      <h2 className={css.label}>{cell.depth === 0 ? 'What it would take' : `Why ${cell.depth}`}</h2>
      <div className={css.curve}>
        {cell.curve.map((v, i) => (
          <span key={i} className={`${css.bar} ${i >= cell.depth ? css.past : ''}`.trim()}
                style={{ height: `${Math.max(2, Math.round((v / top) * 100))}%`,
                         opacity: i < cell.depth ? (0.4 + (v / top) * 0.6).toFixed(2) : 1 }} />
        ))}
      </div>
      {before != null && after != null && (
        <span className={css.cliff}>
          <b>{before.toFixed(2)} → {after.toFixed(2)}</b>
          <span>between game {cell.depth} and game {cell.depth + 1}</span>
        </span>
      )}
      <p className={css.note}>
        Each bar is what one more game would add to what the others already
        cover. It keeps going while that is at least {Math.round(
          (cell.bar / (cell.curve[0] || 1)) * 100)}% of what the first one added
        — the grey bars are the ones that were not.
      </p>
    </div>
  );
}

export default function Collection({ built, state, actions, onOpen }) {
  const { ix, grid, weights, depths, axes } = built;

  const shelf = axes.length === 0 ? grid[0] : null;
  const rows = useMemo(
    () => (shelf ? shelf.picks.map((p) => ix.rowOf.get(p.id)) : []),
    [shelf, ix]);
  // Sorted by what each carries, because that is what the heading claims. In
  // allocation order it was not: pinning a game already on the shelf seeds it
  // first and re-orders everything after it, which read as a reshuffle when
  // nothing about the collection had changed.
  const register = useMemo(() => {
    if (!shelf) return [];
    const carried = sharesOf(ix, weights, rows);
    return shelf.picks
      .map((p, i) => ({ pick: p, carries: carried[i] }))
      .sort((a, b) => b.carries - a.carries);
  }, [shelf, ix, weights, rows]);

  // Two shapes when there is something to compare: what the collection reaches,
  // and what you already own. The distance between them is the whole point.
  const radar = useMemo(() => {
    const n = ix.groups.length;
    const names = ix.groups.map((g) => g.name.split(' · ')[0]);
    const shelved = grid.flatMap((c) => c.picks.map((p) => ix.rowOf.get(p.id)));
    // Coverage, not share-of-mix. Share shrinks when you add a game to the
    // fullest spoke, because everything else is measured against it — which is
    // arithmetic, not news. Coverage only ever grows.
    const reach = coverageOf(shelved.map((r) => spokeVector(ix, weights, r, n)), n);
    const mine = state.owned.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
    if (!mine.length) {
      return { names, values: reach, reference: null, full: Math.min(...reach) > 0.95 };
    }
    return {
      names,
      values: coverageOf(mine.map((r) => spokeVector(ix, weights, r, n)), n),
      reference: reach,
    };
  }, [ix, grid, weights, state.owned]);

  const total = grid.reduce((n, c) => n + c.picks.length, 0);

  return (
    <div className={css.view}>
      <div className={css.split}>
        <aside className={css.side}>
          <div className={css.block}>
            <h2 className={css.label}>
              {radar.reference ? 'Yours against the collection' : 'What it reaches'}
            </h2>
            <Radar names={radar.names} values={radar.values} reference={radar.reference}
                   label={radar.reference ? 'Yours' : 'The collection'}
                   showGaps={!!radar.reference} size={272} />
            {!radar.reference && (
              <p className={css.note}>
                {radar.full
                  ? 'At this size the collection reaches every kind of play, so '
                    + 'the shape is full. Add your own games and this draws '
                    + 'yours against it, which is where the gaps show.'
                  : 'Twelve kinds of play, and how far the collection reaches '
                    + 'into each. Add your own games and this draws them '
                    + 'against it.'}
              </p>
            )}
          </div>

          {shelf && <Why cell={depths?.cell} />}
          <AlreadyFilled built={built} state={state} actions={actions} onOpen={onOpen} />

          <div className={css.block}>
            <h2 className={css.label}>What it contains</h2>
            <Facts ix={ix}
                   rows={grid.flatMap((c) => c.picks.map((p) => ix.rowOf.get(p.id)))} />
          </div>
        </aside>

        <div className={css.main}>
          {shelf ? (
            <>
              <div className={css.head}>
                <h2 className={css.title}>Every game in it</h2>
                <span className={css.depth}>
                  <DepthField value={depths?.cell?.depth ?? shelf.picks.length}
                              auto={depths?.cell?.auto ? depths.cell.depth : depths?.cell?.read}
                              onChange={(v) => actions.setDepth('collection', v)} />
                </span>
                <span className={css.sub}>
                  ordered by how much of the collection each carries
                </span>
              </div>
              <AddNext built={built} actions={actions} />
              {shelf.picks.length === 0 && (
                <p className={css.blank}>
                  Empty. The bars on the left are what each game would add if you
                  took them in order — the first one adds the most because
                  nothing is covered yet.
                </p>
              )}
              <div className={css.list}>
                {register.map(({ pick: p, carries }) => (
                  <div key={p.id} className={css.entry}>
                    <GameItem
                      game={toGameView(ix, ix.rowOf.get(p.id), {
                        carries,
                        owned: state.owned.includes(p.id),
                        pinned: state.pinned.includes(p.id),
                        blocked: state.blocked.includes(p.id),
                      })}
                      onOpen={onOpen}
                      onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                      onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
                  </div>
                ))}
              </div>
              {shelf.alternates?.length > 0 && (
                <details className={css.deck}>
                  <summary className={css.deckHead}>
                    {shelf.alternates.length} on deck — the next in line, if you
                    make room
                  </summary>
                  <div className={css.list}>
                    {shelf.alternates.map((a) => {
                      const row = ix.rowOf.get(a.id);
                      if (row === undefined) return null;
                      return (
                        <div key={a.id} className={css.entry}>
                          <GameItem
                            game={toGameView(ix, row, {
                              owned: state.owned.includes(a.id),
                              pinned: state.pinned.includes(a.id),
                              blocked: state.blocked.includes(a.id),
                            })}
                            onOpen={onOpen}
                            onPin={(g) => actions.pin(g.id, shelvedNow(built), g.name)}
                            onBlock={(g) => actions.block(g.id, shelvedNow(built), g.name)} />
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
              <p className={css.foot}>
                Carries is the share of everything the collection reaches that
                would be lost without that game. The shares do not add to 100 —
                games overlap, and covering the same ground twice is what the
                selection is built to avoid.
              </p>
            </>
          ) : (
            <>
              <div className={css.head}>
                <h2 className={css.title}>
                  {axes.length === 1 ? 'One shelf per group' : 'Thirty-five shelves'}
                </h2>
                <span className={css.sub}>{total} games</span>
              </div>
              <AddNext built={built} actions={actions} />
              <Board built={built} state={state} actions={actions} onOpen={onOpen} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
