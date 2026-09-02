import GameItem from '../game/GameItem.jsx';
import { toGameView } from '../game/view.js';
import { shelvedNow } from '../shelved.js';
import { cellLabeller } from '../views/labels.js';
import { register } from './registry.js';
import css from './analysis.module.css';

/**
 * Which games are in the collection only because you said so.
 *
 * The question a reader asks as "which of mine is not doing anything", and the
 * only form of it this app can answer honestly. It is not a share of coverage —
 * `contributions` and `prunable` said "this game holds 3%" against a space
 * nobody was ever shown, and both are deleted. It is a fact about the
 * allocation: this game was not on a shelf, you pinned it, and now it is.
 *
 * **It cannot be read off the build, and that is measured.** `buildGrid` seeds
 * whichever pins lost the auction, so on an unsplit grid the forced ones are
 * exactly the picks with a null gain — 24 of 213 on the shipped corpus. But a
 * split *deals* the collection out rather than rechoosing it, and a dealt game
 * is seeded too: after one split the same grid reads 213 of 213. So the answer
 * has to be recorded when the pin is pressed, which is what `state.pinAdded`
 * is, and it then survives every split, fit and rebuild.
 *
 * This is what makes "build on mine" worth being a pin rather than a mode. As a
 * mode it held thirty games with nothing on screen to say so and no way to
 * release one; as thirty pins, each is marked, each is one click from being let
 * go, and this block names the ones that are being carried.
 */
export default register({
  id: 'by-hand',
  scope: 'collection',
  run({ built, state, subject }) {
    const { ix, grid } = built;
    // Optional, because every other analysis reads state it can do without and
    // a hand-built state in a test should not have to carry this one field.
    const carried = new Set(state.pinAdded ?? []);
    if (!carried.size) return null;

    // Only what is on a shelf right now. A pin that was later blocked, or one
    // whose game the index no longer carries, is not being carried by anything.
    const cells = subject?.kind === 'cell' ? [subject.cell] : grid;
    const held = cells.flatMap((cell) => cell.picks
      .filter((pick) => carried.has(pick.id))
      .map((pick) => ({ id: pick.id, row: ix.rowOf.get(pick.id), cell })));
    const found = held.filter((g) => g.row !== undefined);
    if (!found.length) return null;

    // The whole set is on the shelves and on My games; the rail shows the first
    // few and says how many it is not showing, rather than implying it is all
    // of them.
    return { games: found.slice(0, 8), total: found.length,
             // An opened shelf is already named by its own title, so naming it
             // again on every row would be the second label on one thing.
             named: subject?.kind !== 'cell' };
  },
  View({ data, built, state, actions, onOpen }) {
    const { ix } = built;
    const label = cellLabeller(built);
    const shelved = shelvedNow(built.grid);
    const rest = data.total - data.games.length;
    return (
      <div className={css.block}>
        <h2 className={css.label}>Only here because you pinned it</h2>
        <div className={css.list}>
          {data.games.map(({ id, row, cell }) => (
            <GameItem key={id} variant="reason" onOpen={onOpen}
                      game={toGameView(ix, row, {
                        owned: state.owned.includes(id),
                        pinned: state.pinned.includes(id),
                        blocked: state.blocked.includes(id),
                        // Where it landed, and nothing more: the note below
                        // says once what all of these rows have in common,
                        // rather than every row repeating it.
                        reason: data.named && cell.key
                          ? `Pinned onto ${label(cell.key)}.` : 'Pinned in.',
                      })}
                      onPin={(g) => actions.pin(g.id, shelved, g.name)}
                      onBlock={(g) => actions.block(g.id, shelved, g.name)} />
          ))}
        </div>
        {/* One string per number rather than a sentence stitched out of five
            expressions — the stitched one read "they arehere" until it was
            rendered and looked at. */}
        <p className={css.note}>
          {data.total === 1
            ? 'This game was not on a shelf when you pinned it, so it is here on '
              + 'your say-so rather than on its own reach. Unpin it and it takes '
              + 'its chances with everything else.'
            : `These ${data.total} were not on a shelf when you pinned them, so `
              + 'they are here on your say-so rather than on their own reach.'
              + (rest > 0 ? ` ${rest} of them are not listed here; My games has `
                + 'the whole set.' : '')
              + ' Unpin one and it takes its chances with everything else.'}
        </p>
      </div>
    );
  },
});
