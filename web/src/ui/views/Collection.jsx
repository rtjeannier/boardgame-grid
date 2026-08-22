import { useMemo } from 'react';
import { mixOf, spokeVector } from '../../engine/index.js';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import Radar from '../chart/Radar.jsx';
import Button from '../primitives/Button.jsx';
import DepthField from '../primitives/DepthField.jsx';
import { sharesOf } from '../state.js';
import Board, { shelvedNow } from './Board.jsx';
import css from './Collection.module.css';

/**
 * The collection, however it happens to be cut.
 *
 * With no axes there is one shelf and it is worth reading in full, so this is a
 * register: every game, what it does, and how much of the whole it carries.
 * Split it and the register gives way to `Board`, because thirty-five shelves
 * of five are a shape rather than a list.
 */

const spread = (values) => {
  const at = (n) => values.filter((v) => v <= n).length;
  return { at };
};

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
    const reach = mixOf(shelved.map((r) => spokeVector(ix, weights, r, n)), n);
    const mine = state.owned.map((id) => ix.rowOf.get(id)).filter((r) => r !== undefined);
    if (!mine.length) return { names, values: reach, reference: null };
    // Each shape normalised to its own largest spoke, so this compares what the
    // two are *made of* rather than how many games each has. Comparing volume
    // would only ever say "you own fewer games", which you knew.
    return {
      names,
      values: mixOf(mine.map((r) => spokeVector(ix, weights, r, n)), n),
      reference: reach,
    };
  }, [ix, grid, weights, state.owned]);

  const total = grid.reduce((n, c) => n + c.picks.length, 0);
  const last = shelf?.picks?.length ? shelf.picks[shelf.picks.length - 1].gain : null;

  return (
    <div className={css.view}>
      <div className={css.split}>
        <aside className={css.side}>
          <div className={css.block}>
            <h2 className={css.label}>
              {radar.reference ? 'Yours against the collection' : 'What it is made of'}
            </h2>
            <Radar names={radar.names} values={radar.values} reference={radar.reference}
                   label={radar.reference ? 'Yours' : 'The collection'}
                   showGaps={!!radar.reference} size={272} />
            {!radar.reference && (
              <p className={css.note}>
                Twelve kinds of play, and how much of the collection sits on
                each — the fullest spoke sets the edge. Add your own games and
                this draws their shape against it.
              </p>
            )}
          </div>

          {shelf && <Why cell={depths?.cell} />}

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
              {depths?.cell?.nextName && (
                <div className={css.addRow}>
                  <Button onClick={() => actions.setDepth(
                    'collection', (depths.cell.depth ?? shelf.picks.length) + 1)}>
                    ＋ Add {depths.cell.nextName}
                  </Button>
                  <span className={css.addNote}>
                    {last == null
                      ? `Adds ${depths.cell.next?.toFixed(2)} — the most of anything left.`
                      : `Adds ${depths.cell.next?.toFixed(2)}, against ${last.toFixed(2)} for the last one in.`}
                  </span>
                </div>
              )}
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
              <Board built={built} state={state} actions={actions} onOpen={onOpen} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
