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

  const cell = built.grid.find((c) => c.key === focus.key);
  if (!cell) return null;

  // The same analyses the rail runs, told to describe this shelf instead. A
  // shelf is the scale these measures mean anything at — a figure averaged over
  // 272 games is a column of zeros — so the rail describes the page and this
  // describes the shelf, and both render at once.
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
