import { useMemo } from 'react';
import * as engine from '../../engine/index.js';
import Drawer from '../primitives/Drawer.jsx';
import Button from '../primitives/Button.jsx';
import Bars from '../chart/Bars.jsx';
import { axesOf } from '../game/view.js';
import { sharesOf } from '../state.js';
import { Block, Pin } from '../icons.jsx';
import { shelvedNow } from './Board.jsx';
import { cellLabeller } from './labels.js';
import css from './GameDrawer.module.css';

/**
 * One game, in front of everything else.
 *
 * Bars rather than a radar, and this is the reason: measured, Ra loads on four
 * of the twelve spokes and sits at zero on the other eight, so a twelve-pointer
 * would be mostly empty air. Its axes carry the meaning instead. A radar is for
 * sets, and there is one on the collection view.
 */
export default function GameDrawer({ game, built, state, actions, onClose }) {
  const open = !!game;
  const { ix, grid, weights } = built ?? {};
  const label = useMemo(() => (built ? cellLabeller(built) : () => ''), [built]);

  const detail = useMemo(() => {
    if (!game || !ix) return null;
    const row = ix.rowOf.get(game.id);
    if (row === undefined) return null;

    const shelfOf = new Map();
    for (const c of grid) for (const p of c.picks) shelfOf.set(p.id, c.key);
    const home = grid.find((c) => c.picks.some((p) => p.id === game.id));
    const at = home ? home.picks.findIndex((p) => p.id === game.id) : -1;

    // Nearest across the whole corpus, not only among games already shelved.
    // Deciding what to keep means seeing everything like it — including the
    // near-twin nobody chose, which is exactly the one that makes a game
    // redundant.
    const near = [];
    for (let other = 0; other < ix.n; other++) {
      if (other === row) continue;
      const score = engine.similarityBetween(ix, row, other);
      if (score > 0.2) near.push({ row: other, score });
    }
    near.sort((a, b) => b.score - a.score);

    // What the shelf would lose without it: the pruning question, asked of the
    // shelf it actually holds.
    let carries = null;
    if (home) {
      const rows = home.picks.map((p) => ix.rowOf.get(p.id));
      carries = sharesOf(ix, weights, rows)[at];
    }

    return {
      row,
      axes: axesOf(ix, row, { limit: 6, floor: 0.03 }),
      home, at, carries,
      near: near.slice(0, 6).map((n) => ({
        ...n,
        id: ix.ids[n.row],
        name: ix.names[n.row],
        rank: ix.rank[n.row],
        shelf: shelfOf.get(ix.ids[n.row]) ?? null,
        mine: state.owned.includes(ix.ids[n.row]),
      })),
      gain: home && at >= 0 ? home.gains?.[at] : null,
      next: home?.alternates?.[0]?.name ?? null,
      scale: ix.similarityScale,
    };
  }, [game, ix, grid, weights, state.owned]);

  if (!open || !detail) return <Drawer open={false} onClose={onClose} />;

  const pinned = state.pinned.includes(game.id);
  const blocked = state.blocked.includes(game.id);
  const owned = state.owned.includes(game.id);

  return (
    <Drawer open onClose={onClose} head={(
      <>
        <h2 className={css.name}>{game.name}</h2>
        <span className={css.sub}>
          {game.rankLabel} · rated {ix.rating[detail.row].toFixed(2)} ·{' '}
          <a className={css.link} href={`https://boardgamegeek.com/boardgame/${game.id}`}
             target="_blank" rel="noreferrer">BoardGameGeek ↗</a>
        </span>
        <div className={css.stats}>
          {game.players && <span className={css.stat}><b>{game.players}</b><span>best at</span></span>}
          <span className={css.stat}><b>{game.timeLabel}</b><span>length</span></span>
          <span className={css.stat}><b>{game.weight}</b><span>weight</span></span>
          {game.year ? <span className={css.stat}><b>{game.year}</b><span>published</span></span> : null}
        </div>
      </>
    )}>
      <div className={css.verbs}>
        <Button tone={owned ? 'primary' : 'default'} onClick={() => actions.own(game.id)}>
          {owned ? 'You own this' : 'I own this'}
        </Button>
        <Button tone={pinned ? 'primary' : 'default'} onClick={() => actions.pin(game.id, shelvedNow(built), game.name)}>
          <Pin filled={pinned} /> {pinned ? 'Pinned' : 'Pin'}
        </Button>
        <Button tone="stop" onClick={() => actions.block(game.id, shelvedNow(built), game.name)}>
          <Block /> {blocked ? 'Blocked' : 'Block'}
        </Button>
        <Button tone="later" title="Not built yet">Wishlist</Button>
      </div>

      <section className={css.sec}>
        <h3 className={css.label}>What it does</h3>
        <p className={css.blurb}>
          The things this game is most about, and how much of it each accounts
          for — the same evidence the collection is built on.
        </p>
        <Bars items={detail.axes} />
      </section>

      <section className={css.sec}>
        <h3 className={css.label}>Games like it</h3>
        <p className={css.blurb}>
          Anywhere in the corpus, not only on the shelves — the near-twin nobody
          chose is exactly the one that would make this redundant.
          {detail.scale && ` Two unrelated games score ${detail.scale.p50.toFixed(2)}; `}
          {detail.scale && `anything above ${detail.scale.p90.toFixed(2)} is in the top tenth of all pairs.`}
        </p>
        <div className={css.like}>
          {detail.near.map((s) => (
            <div key={s.id} className={css.likeRow}>
              <span className={css.likeName}>
                {s.name} <span className={css.likeRank}>#{s.rank}</span>
              </span>
              <span className={css.likeShelf}>
                {s.mine ? 'yours · ' : ''}{s.shelf != null ? label(s.shelf) : 'not shelved'}
              </span>
              <span className={css.likeScore}>{s.score.toFixed(2)}</span>
            </div>
          ))}
          {!detail.near.length && (
            <span className={css.blurb}>Nothing in the corpus is much like it.</span>
          )}
        </div>
      </section>

      <section className={css.sec}>
        <h3 className={css.label}>Its place</h3>
        <div className={css.place}>
          {detail.home ? (
            <>
              <div className={css.placeRow}>
                <span>Holds</span>
                <b>{label(detail.home.key)}</b>
                <em>{detail.at + 1} of {detail.home.picks.length} on that shelf</em>
              </div>
              {detail.carries != null && (
                <div className={css.placeRow}>
                  <span>Carries</span>
                  <b><em>{(detail.carries * 100).toFixed(0)}%</em> of what that shelf covers</b>
                </div>
              )}
              {detail.gain != null && (
                <div className={css.placeRow}>
                  <span>Added</span>
                  <b><em>{detail.gain.toFixed(2)}</em> of what the shelf was still missing</b>
                </div>
              )}
              {detail.next && (
                <div className={css.placeRow}>
                  <span>Without it</span><b>{detail.next}</b><em>the next best there</em>
                </div>
              )}
            </>
          ) : (
            <div className={css.placeRow}>
              <span>Not shelved</span>
              <b>{game.reason ?? 'Something else covers the same ground.'}</b>
            </div>
          )}
        </div>
      </section>
    </Drawer>
  );
}
