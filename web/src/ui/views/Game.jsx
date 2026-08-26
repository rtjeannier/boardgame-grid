import { useMemo } from 'react';
import * as engine from '../../engine/index.js';
import Button from '../primitives/Button.jsx';
import Bars from '../chart/Bars.jsx';
import { axesOf } from '../game/view.js';
import { Block, Pin } from '../icons.jsx';
import css from './Game.module.css';

/**
 * One game, and only the game.
 *
 * It used to describe the shelf it sat on — which shelf, second of six on it,
 * carrying 31% of what that shelf covered, what would replace it. All of that
 * is true of a game *in a grid*, and it changed under you every time you split
 * differently. What a reader wants here is the game, so this is agnostic of
 * where it landed.
 *
 * Bars rather than a radar, and this is the reason: measured, Ra loads on four
 * of the twelve spokes and sits at zero on the other eight, so a twelve-pointer
 * would be mostly empty air. Its axes carry the meaning instead. A radar is for
 * sets, and there is one on a shelf.
 */
export default function Game({ game, built, state, actions }) {
  const { ix } = built;
  const detail = useMemo(() => {
    if (!game || !ix) return null;
    const row = ix.rowOf.get(game.id);
    if (row === undefined) return null;

    // Nearest across the whole corpus, not only among games already shelved.
    // Deciding what to keep means seeing everything like it — including the
    // near-twin nobody chose, which is exactly the one that makes it redundant.
    const near = [];
    for (let other = 0; other < ix.n; other++) {
      if (other === row) continue;
      const score = engine.similarityBetween(ix, row, other);
      if (score > 0.2) near.push({ row: other, score });
    }
    near.sort((a, b) => b.score - a.score);

    return {
      row,
      // These sum to 1 across a game's whole vector, so they are already shares
      // of what the game is — see the fixed scale passed to `Bars` below.
      axes: axesOf(ix, row, { limit: 6, floor: 0.03 }),
      near: near.slice(0, 6).map((n) => ({
        ...n, id: ix.ids[n.row], name: ix.names[n.row], rank: ix.rank[n.row],
        mine: state.owned.includes(ix.ids[n.row]),
      })),
    };
  }, [game, ix, state.owned]);

  if (!detail) return null;
  const shelved = built.grid.flatMap((c) => c.picks.map((p) => p.id));
  const pinned = state.pinned.includes(game.id);
  const blocked = state.blocked.includes(game.id);
  const owned = state.owned.includes(game.id);

  return (
    <>
      <div>
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
      </div>

      <div className={css.verbs}>
        <Button tone={owned ? 'primary' : 'default'} onClick={() => actions.own(game.id)}>
          {owned ? 'You own this' : 'I own this'}
        </Button>
        <Button tone={pinned ? 'primary' : 'default'}
                onClick={() => actions.pin(game.id, shelved, game.name)}>
          <Pin filled={pinned} /> {pinned ? 'Pinned' : 'Pin'}
        </Button>
        <Button tone="stop" onClick={() => actions.block(game.id, shelved, game.name)}>
          <Block /> {blocked ? 'Blocked' : 'Block'}
        </Button>
      </div>

      <section className={css.sec}>
        <h3 className={css.label}>What it does</h3>
        <p className={css.blurb}>
          Its share of what the game is, across the axes the model found. A game
          that is mostly one thing has one long bar; a game that is a bit of
          everything has six short ones, and that is the fact worth seeing.
        </p>
        {/* Fixed to 1, not to the longest bar. The loadings sum to 1, so
            re-scaling them to the row maximum made every game's top axis full
            width and turned an evenly-spread game into a solid block. */}
        <Bars items={detail.axes} max={1} percent />
      </section>

      <section className={css.sec}>
        <h3 className={css.label}>Games like it</h3>
        <p className={css.blurb}>
          How much ground each shares with it, whether or not it was chosen.
        </p>
        {detail.near.length ? (
          <Bars labelWidth={200} max={1} percent
                items={detail.near.map((n) => ({
                  label: `${n.name}  #${n.rank}`, value: n.score, mark: n.mine,
                }))} />
        ) : (
          <span className={css.blurb}>Nothing in the corpus is much like it.</span>
        )}
      </section>
    </>
  );
}
