import { redundancies, spokeCoverage } from '../../engine/index.js';
import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import { cellLabeller } from '../views/labels.js';
import { rowsOfPicks, shelvedNow } from '../shelved.js';
import { register } from './registry.js';
import css from './analysis.module.css';

/**
 * What is missing from a shelf, and what is on it twice.
 *
 * Two questions, both answered by *naming a game* — which is the line this
 * module now holds to. It also carried two findings that answered in shares of
 * a shelf's coverage ("this game holds 3%", "these three together hold 12.9%"),
 * and those are gone: a percentage of a space nobody has been shown is not
 * something a reader can act on. See `engine/shelf.js` for the note, and
 * BUGS.md for what should replace them.
 *
 *   Gaps        the game that would add most, and which kinds of play it
 *               brings that nothing here brings.
 *   Duplicates  the same game twice — a lookup against what BGG publishes,
 *               binary because identity is, each named with the game that
 *               covers it.
 *
 * The silence is correct, and worth not "fixing". A collection built to avoid
 * duplication has no duplicates in it: measured, the closest pair in the
 * recommended collection sits at **0.44** similarity, and a genuine duplicate
 * (Gloomhaven and Jaws of the Lion) sits at **0.95**. No threshold on likeness
 * can do this job — 7 Wonders and its second edition score 0.79, below any
 * floor that also excludes Navegador and Orléans.
 */

/**
 * The kinds of play a candidate brings that the shelf has least of.
 *
 * Measured as the coverage the shelf *gains* by taking the game, on the axes and
 * projected into the twelve families for naming. It used to multiply the game's
 * spoke vector by what the shelf lacked *in spoke space*, which is measuring in
 * the second space CLAUDE.md forbids — and it did not agree with itself: on the
 * shipped corpus it named a different top family on 7 of 30 shelves, calling
 * Roll for the Galaxy "Area Majority / Influence" where the axes say "Dice", and
 * Kites "Cooperative Game" where they say "Real-time". A reader reading those
 * labels against the radar, which has always projected from the axes, was being
 * shown two different answers to one question.
 */
function brings(ix, weights, rows, row) {
  const have = spokeCoverage(ix, weights, rows);
  const after = spokeCoverage(ix, weights, [...rows, row]);
  return ix.groups
    .map((g, i) => ({ name: g.name.split(' · ')[0], adds: after[i] - have[i] }))
    .filter((g) => g.adds > 0.005)
    .sort((a, b) => b.adds - a.adds)
    .slice(0, 2);
}

/** One shelf, read both ways. */
function readShelf(ix, weights, cell, { owned }) {
  const rows = rowsOfPicks(ix, cell.picks);
  if (rows.length < 2) return null;
  // A duplicate is the same game under two names — BGG says so, and it is a
  // lookup with no threshold. It proposes no cut: the runner-up is the game the
  // selection already turned down, and putting it in makes the shelf worse —
  // measured, one shelf went 0.372 to 0.141.
  const dupes = redundancies(ix, rows, { limit: 3 })
    .map((r) => ({ ...r, mine: owned.includes(r.id) }));

  const next = cell.alternates?.[0] ?? null;
  const nextRow = next ? ix.rowOf.get(next.id) : undefined;
  const gap = nextRow === undefined ? null : {
    id: next.id, row: nextRow, gain: next.gain,
    brings: brings(ix, weights, rows, nextRow),
  };
  return (gap || dupes.length) ? { gap, dupes } : null;
}

function Reason({ built, state, actions, onOpen, row, reason, mine }) {
  const { ix } = built;
  const shelved = shelvedNow(built.grid);
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
    const opts = { owned: state.owned };

    if (subject?.kind === 'cell') {
      const read = readShelf(ix, weights, subject.cell, opts);
      // The overlay title already names the shelf, so naming it again here
      // would be the second label on one thing.
      return read && { ...read, shelf: null };
    }
    // Rolled up as one named shelf per question — the shelf with the biggest
    // gap, the shelf holding the thinnest game — never a figure averaged across
    // shelves, which every one of these measures saturates to zero.
    const perShelf = grid
      .map((cell) => ({ cell, read: readShelf(ix, weights, cell, opts) }))
      .filter((x) => x.read);
    if (!perShelf.length) return null;
    const widest = perShelf
      .filter((x) => x.read.gap)
      .sort((a, b) => (b.read.gap.gain ?? 0) - (a.read.gap.gain ?? 0))[0];
    // Both halves still measured on the shelf each game sits on — across 272
    // games every share reads 0.0000, so a collection-wide figure would be a
    // column of zeros.
    const dupes = perShelf
      .flatMap((x) => x.read.dupes.map((d) => ({ ...d, cell: x.cell })))
      .slice(0, 3);
    if (!widest && !dupes.length) return null;
    return {
      gap: widest?.read.gap ?? null,
      shelf: widest?.cell ?? null,
      dupes,
    };
  },
  View({ data, built, state, actions, onOpen }) {
    const name = cellLabeller(built);
    const label = (cell) => (cell ? name(cell.key) : null);
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
        {data.dupes.length > 0 && (
          <>
            <h2 className={css.label}>The same game twice</h2>
            <div className={css.list}>
              {data.dupes.map((d) => (
                <Reason key={d.id} built={built} state={state} actions={actions}
                        onOpen={onOpen} row={d.row} mine={d.mine}
                        reason={(d.why === 'recorded'
                          ? `${d.filledBy.name} is the same game, more fully recorded`
                          : `${d.filledBy.name} reimplements it, by BoardGameGeek`)
                          + (label(d.cell) ? `, on ${label(d.cell)}.` : '.')} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  },
});
