/**
 * Render every view, for real, without a browser.
 *
 * Vite compiles the JSX and React renders it to a string, so a component that
 * throws throws here. This exists because it did not: `CoverageRadar` tests
 * membership with `baseIds.has(...)`, the shelf handed it an array, and the
 * failure only appeared once a reader added their first game — several frames
 * deep, reading as the radar being broken rather than the caller being wrong.
 *
 * The states below are chosen to be the ones that *change shape*: an empty
 * shelf and a full one, a cell with and without a selection, a search with and
 * without matches.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');

let vite, render, React, engine;

before(async () => {
  const { createServer } = await import('vite');
  vite = await createServer({
    root: WEB, logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  ({ renderToString: render } = await import('react-dom/server'));
  React = (await import('react')).default;
  engine = await vite.ssrLoadModule('/src/engine/index.js');
});

after(async () => { await vite?.close(); });

const contract = () => JSON.parse(readFileSync(
  join(WEB, '..', 'tests', 'parity', 'seed-contract.json'), 'utf8'));

/** Render, and let anything thrown fail the test with its own message. */
const draw = (Component, props) => render(React.createElement(Component, props));

test('the grid draws, with and without a shelf', async () => {
  const ix = engine.indexContract(contract());
  const { default: Grid } = await vite.ssrLoadModule('/src/Grid.jsx');
  const { data, grid } = engine.buildGrid(ix);
  const owned = new Set(grid.flatMap((c) => c.picks.map((p) => p.id)).slice(0, 5));

  for (const [label, mine] of [['empty', new Set()], ['with owned games', owned]]) {
    const html = draw(Grid, { data, active: new Set(), selected: null, onSelect() {}, owned: mine });
    assert.ok(html.includes('grid__colhead'), `${label}: no columns rendered`);
  }
});

test('the cell drawer draws, including its radar and scatter', async () => {
  const ix = engine.indexContract(contract());
  const { default: Detail } = await vite.ssrLoadModule('/src/Detail.jsx');
  const { data } = engine.buildGrid(ix);
  const cell = data.cells.find((c) => c.assignments.length >= 2 && c.alternates.length);
  assert.ok(cell, 'precondition: a cell with picks and alternates');

  const html = draw(Detail, {
    cell, meta: data.meta, active: new Set(), onClose() {},
    owned: new Set([cell.assignments[0].game.id]), onBan() {}, onOwn() {},
  });
  assert.ok(html.includes('Also here'), 'alternates missing');
  assert.ok(html.includes('chipbtn'), 'the ban / shelf actions are missing');
});

test('the shelf draws empty, and again once games are added', async () => {
  const ix = engine.indexContract(contract());
  const { default: Shelf } = await vite.ssrLoadModule('/src/Shelf.jsx');
  const { DEFAULTS } = await vite.ssrLoadModule('/src/settings.js');
  const result = engine.buildGrid(ix);

  // Empty: no analysis, no audit.
  draw(Shelf, { ix, result, settings: { ...DEFAULTS }, update() {} });

  // Non-empty: this is the state that used to crash.
  const owned = result.grid.flatMap((c) => c.picks.map((p) => p.id)).slice(0, 8);
  const withGames = engine.buildGrid(ix, { owned });
  const html = draw(Shelf, {
    ix, result: withGames,
    settings: { ...DEFAULTS, owned, keepers: [owned[0]], banned: [owned[1]] },
    update() {},
  });
  assert.ok(html.includes('What your shelf covers'), 'the coverage panel is missing');
  assert.ok(html.includes('Not shelved') || html.includes('Pulling the least weight'));
});

test('the coverage radar refuses an array where it needs a Set', async () => {
  const { default: CoverageRadar } = await vite.ssrLoadModule('/src/CoverageRadar.jsx');
  const games = [{ id: 1, name: 'A', coverage: [0.5, 0.2] }];
  assert.throws(
    () => draw(CoverageRadar, {
      dimensions: ['x', 'y'], games, baseIds: [1], selected: new Set(),
      mode: 'combined', onMode() {},
    }),
    /must be Sets/,
    'the shape mistake has to fail loudly, not several frames deep',
  );
  // And the correct shape draws.
  draw(CoverageRadar, {
    dimensions: ['x', 'y'], games, baseIds: new Set([1]), selected: new Set(),
    mode: 'combined', onMode() {},
  });
});

test('the settings panel draws, including the column editor', async () => {
  const ix = engine.indexContract(contract());
  const { default: Controls } = await vite.ssrLoadModule('/src/Controls.jsx');
  const { DEFAULTS } = await vite.ssrLoadModule('/src/settings.js');
  const html = draw(Controls, {
    settings: { ...DEFAULTS }, update() {}, reset() {},
    genres: ix.groups.map((g) => g.name), ms: 42,
  });
  assert.ok(html.includes('Tune the grid'));
});
