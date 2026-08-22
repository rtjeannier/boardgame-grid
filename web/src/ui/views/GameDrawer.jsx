import { useMemo } from 'react';
import * as engine from '../../engine/index.js';
import Drawer from '../primitives/Drawer.jsx';
import Button from '../primitives/Button.jsx';
import Bars from '../chart/Bars.jsx';
import { axesOf } from '../game/view.js';
import { Block, Pin } from '../icons.jsx';
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

    const shelved = grid.flatMap((c) => c.picks.map((p) => ({
      row: ix.rowOf.get(p.id), cell: c.key, id: p.id,
    })));
    const home = grid.find((c) => c.picks.some((p) => p.id === game.id));
    const at = home ? home.picks.findIndex((p) => p.id === game.id) : -1;

    // Nearest among games actually shelved — not the nearest in the corpus.
    // Those are different claims, and only this one tells you whether tonight
    // would feel repetitive.
    const near = shelved
      .filter((s) => s.id !== game.id && s.row !== undefined)
      .map((s) => ({ ...s, score: engine.similarityBetween(ix, row, s.row) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      row,
      axes: axesOf(ix, row, { limit: 6, floor: 0.03 }),
      home, at, near,
      gain: home && at >= 0 ? home.gains?.[at] : null,
      next: home?.alternates?.[0]?.name ?? null,
      scale: ix.similarityScale,
    };
  }, [game, ix, grid, weights]);

  if (!open || !detail) return <Drawer open={false} onClose={onClose} />;

  const pinned = state.pinned.includes(game.id);
  const blocked = state.blocked.includes(game.id);
  const owned = state.owned.includes(game.id);

  return (
    <Drawer open onClose={onClose} head={(
      <>
        <h2 className={css.name}>{game.name}</h2>
        <span className={css.sub}>
          {game.rankLabel} · rated {ix.rating[detail.row].toFixed(2)}
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
        <Button tone={pinned ? 'primary' : 'default'} onClick={() => actions.pin(game.id)}>
          <Pin filled={pinned} /> {pinned ? 'Pinned' : 'Pin'}
        </Button>
        <Button tone="stop" onClick={() => actions.block(game.id)}>
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
        <h3 className={css.label}>Closest to it in the collection</h3>
        <p className={css.blurb}>
          Not the closest games that exist — the closest ones actually shelved,
          which is what tells you whether tonight would feel repetitive.
          {detail.scale && ` Two unrelated games score ${detail.scale.p50.toFixed(2)};
            anything above ${detail.scale.p90.toFixed(2)} is in the top tenth of all pairs.`}
        </p>
        <div className={css.like}>
          {detail.near.map((s) => (
            <div key={s.id} className={css.likeRow}>
              <span className={css.likeName}>{ix.names[s.row]}</span>
              <span className={css.likeShelf}>{label(s.cell)}</span>
              <span className={css.likeScore}>{s.score.toFixed(2)}</span>
            </div>
          ))}
          {!detail.near.length && <span className={css.blurb}>Nothing else is shelved yet.</span>}
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
