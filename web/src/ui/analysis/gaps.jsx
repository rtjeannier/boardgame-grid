import { coverageOf, redundancies, spokeVector } from '../../engine/index.js';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import { register } from './registry.js';
import css from './analysis.module.css';

/**
 * What is missing from a shelf, and what is doubled up on it.
 *
 * This replaces "held twice", which had two problems and only one of them was
 * the measure. It reported **0 findings on the unsplit collection and findings
 * in 3 of 30 shelves**, which read as an analysis that never works — but that
 * silence is correct: measured, the closest pair in the recommended collection
 * sits at **0.44** similarity, and a genuine duplicate (Gloomhaven and Jaws of
 * the Lion) sits at **0.95**. A collection built to avoid duplication has no
 * duplicates in it, and saying so is the honest answer.
 *
 * What was actually missing was the other half. A reader asking "what should I
 * change" needs both directions, so:
 *
 *   Gaps         the game that would add most, and which kinds of play it
 *                brings that nothing here brings.
 *   Redundancies the games holding least of their own, each named with the
 *                game on the shelf that covers them.
 *
 * **It only means anything at shelf scale.** Across 272 games every game's
 * unique share reads 0.0000 — the measure saturates, exactly as the radar does
 * — while on a shelf of nine it spreads 15% down to 4%. So the collection-level
 * form is the same computation per shelf, rolled up and named by shelf, never
 * a 272-game average of zeros.
 *
 * The invariant worth keeping: a collection nobody uploaded and nothing pinned
 * is already the optimum of the thing being optimised, so it should have little
 * to report. Measured unsplit today: no game under 1% unique, and the best game
 * left out would add 0.29 against 0.88 for the median game already in.
 */

/** The kinds of play a candidate brings that the shelf has least of. */
function brings(ix, weights, rows, row, n) {
  const have = coverageOf(rows.map((r) => spokeVector(ix, weights, r, n)), n);
  const mine = spokeVector(ix, weights, row, n);
  return [...mine]
    .map((v, i) => ({ name: ix.groups[i].name.split(' · ')[0], adds: v * (1 - have[i]) }))
    .filter((g) => g.adds > 0.01)
    .sort((a, b) => b.adds - a.adds)
    .slice(0, 2);
}

/** One shelf, read both ways. */
function readShelf(ix, weights, cell, { owned, floor }) {
  const rows = cell.picks.map((p) => ix.rowOf.get(p.id)).filter((r) => r !== undefined);
  if (rows.length < 2) return null;
  const n = ix.groups.length;
  // The existing measure, kept: it names the *more contained* half of a pair
  // rather than whichever came first, and it stays quiet where there is nothing
  // to say. No cut is proposed — the runner-up is the game the selection
  // already turned down, and putting it in makes the shelf worse; measured, one
  // shelf went 0.372 to 0.141. The redundancy is reported, the decision is not.
  const thin = redundancies(ix, weights, rows, { floor })
    .map((r) => ({ ...r, mine: owned.includes(r.id) }))
    .sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0))
    .slice(0, 3);

  const next = cell.alternates?.[0] ?? null;
  const nextRow = next ? ix.rowOf.get(next.id) : undefined;
  const gap = nextRow === undefined ? null : {
    id: next.id, row: nextRow, gain: next.gain,
    brings: brings(ix, weights, rows, nextRow, n),
  };
  return (gap || thin.length) ? { gap, thin } : null;
}

function Reason({ built, state, actions, onOpen, row, reason, mine }) {
  const { ix } = built;
  const shelved = built.grid.flatMap((c) => c.picks.map((p) => p.id));
  return (
    <GameItem variant="reason"
              game={toGameView(ix, row, {
                owned: mine ?? state.owned.includes(ix.ids[row]),
                pinned: state.pinned.includes(ix.ids[row]),
                blocked: state.blocked.includes(ix.ids[row]),
                reason,
              })}
              onOpen={onOpen}
              onPin={(x) => actions.pin(x.id, shelved, x.name)}
              onBlock={(x) => actions.block(x.id, shelved, x.name)} />
  );
}

export default register({
  id: 'gaps',
  scope: 'collection',
  run({ built, state, subject }) {
    const { ix, weights, grid } = built;
    const opts = { owned: state.owned, floor: ix.defaults?.redundancyFloor ?? 0.9 };

    if (subject?.kind === 'cell') {
      const read = readShelf(ix, weights, subject.cell, opts);
      return read && { ...read, shelf: null };
    }
    // Rolled up: the shelf with the biggest gap, and the thinnest games
    // anywhere, each still measured on the shelf it sits on.
    const perShelf = grid
      .map((cell) => ({ cell, read: readShelf(ix, weights, cell, opts) }))
      .filter((x) => x.read);
    if (!perShelf.length) return null;
    const widest = perShelf
      .filter((x) => x.read.gap)
      .sort((a, b) => (b.read.gap.gain ?? 0) - (a.read.gap.gain ?? 0))[0];
    const thin = perShelf
      .flatMap((x) => x.read.thin.map((t) => ({ ...t, cell: x.cell })))
      .sort((a, b) => a.share - b.share)
      .slice(0, 3);
    if (!widest && !thin.length) return null;
    return {
      gap: widest?.read.gap ?? null,
      shelf: widest?.cell ?? null,
      thin,
    };
  },
  View({ data, built, state, actions, onOpen }) {
    const { ix } = built;
    const label = (cell) => (cell ? cellLabel(built, cell.key) : null);
    return (
      <div className={css.block}>
        {data.gap && (
          <>
            <h2 className={css.label}>Gaps — what is missing</h2>
            <div className={css.list}>
              <Reason built={built} state={state} actions={actions} onOpen={onOpen}
                      row={data.gap.row}
                      reason={`Adds ${data.gap.gain?.toFixed(2)}`
                        + (data.gap.brings.length
                          ? ` — the most ${data.gap.brings.map((b) => b.name).join(' and ')} `
                            + 'left uncovered' : '')
                        + (data.shelf ? `, on ${label(data.shelf)}.` : '.')} />
            </div>
          </>
        )}
        {data.thin.length > 0 && (
          <>
            <h2 className={css.label}>Doubled up — what is covered twice</h2>
            <div className={css.list}>
              {data.thin.map((t) => (
                <Reason key={t.id} built={built} state={state} actions={actions}
                        onOpen={onOpen} row={t.row} mine={t.mine}
                        reason={`${t.filledBy.name} already covers `
                          + `${Math.round(t.share * 100)}% of what it brings.`} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  },
});

/** A cell key as a person would say it, without importing the whole labeller. */
function cellLabel(built, key) {
  if (!key) return 'the collection';
  const rowName = new Map(built.rows.map((r) => [String(r.index), r.name]));
  const parts = key.split('|');
  if (parts.length === 1) return rowName.get(parts[0]) ?? `${parts[0]} players`;
  const [column, row] = parts;
  return `${column === '1' ? 'solo' : `${column} players`} · ${rowName.get(row) ?? row}`;
}
