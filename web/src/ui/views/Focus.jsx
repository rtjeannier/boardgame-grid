import Overlay from '../primitives/Overlay.jsx';
import { analyse } from '../analysis/index.js';
import Game from './Game.jsx';
import Cell from './Cell.jsx';
import { cellLabeller } from './labels.js';

/**
 * Whatever you have opened, on the one surface there is for opening things.
 *
 * A shelf and a game are the same kind of act — a thing you clicked, shown at
 * full size — so they share a surface rather than each having their own. The
 * shelf you get is the same component the grid is made of and the same one the
 * unsplit screen is, so opening a cell gives you the collection screen scoped
 * to that cell, which is what it should always have been.
 */
export default function Focus({ built, state, actions }) {
  const focus = state.focus;
  if (!focus) return null;

  if (focus.kind === 'game') {
    return (
      <Overlay open onClose={actions.unfocus} title={focus.game?.name}
               onBack={focus.from ? actions.back : null}>
        <Game game={focus.game} built={built} state={state} actions={actions} />
      </Overlay>
    );
  }

  const cell = focus.kind === 'collection'
    ? { key: '', picks: built.grid.flatMap((c) => c.picks), alternates: [] }
    : built.grid.find((c) => c.key === focus.key);
  if (!cell) return null;

  // The same analyses the rail runs, told to describe this shelf instead. They
  // are the reason a shelf is worth opening: at 272 games every game's unique
  // share reads 0.0000, and on a shelf of nine it spreads 15% down to 4%.
  const found = analyse({ built, state, subject: { kind: 'cell', cell } });
  const analyses = found.length ? (
    <>
      {found.map(({ analysis, data }) => (
        <analysis.View key={analysis.id} data={data} built={built} state={state}
                       actions={actions} onOpen={(g) => actions.focusGame(g, focus)} />
      ))}
    </>
  ) : null;

  return (
    <Overlay open onClose={actions.unfocus} title={cellLabeller(built)(cell.key)}>
      <Cell cell={cell} built={built} state={state} actions={actions}
            size="full" analyses={analyses}
            onOpen={(g) => actions.focusGame(g, focus)} />
    </Overlay>
  );
}
