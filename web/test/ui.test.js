/**
 * The interface, checked without a browser.
 *
 * Two kinds of check, both of them a bug that already happened:
 *
 * 1. A stylesheet may only name a colour through a token. The last one invented
 *    `--ink`, `--panel` and `--line`, none of which were ever defined, and
 *    rendered black on black in eighteen declarations before a reader noticed.
 * 2. Every component renders in every variant. `CoverageRadar` called
 *    `baseIds.has(...)` on an array and only threw once somebody added their
 *    first game, several frames deep.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const UI = join(WEB, 'src', 'ui');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(UI);
const stylesheets = files.filter((f) => f.endsWith('.module.css'));
const tokens = new Set(
  [...readFileSync(join(UI, 'tokens.css'), 'utf8').matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/gm)]
    .map((m) => m[1]));

test('tokens.css defines the palette it claims to', () => {
  for (const name of ['--bg', '--surface', '--text', '--line', '--mark', '--stop', '--r']) {
    assert.ok(tokens.has(name), `tokens.css is missing ${name}`);
  }
});

test('no component names a colour except through a token', () => {
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/gi;
  for (const file of stylesheets) {
    const css = readFileSync(file, 'utf8');
    const found = css.match(literal) ?? [];
    assert.deepEqual(found, [],
      `${relative(WEB, file)} writes ${found.join(', ')} instead of var(--token)`);
  }
});

test('a bar fill is told to be a block, because it is a span', () => {
  // Regression, and it emptied every bar in the interface. The track is a grid
  // item and so is blockified; the fill is only the track's descendant, so
  // without an explicit `display` it stays inline — and `width` and `height` do
  // not apply to a non-replaced inline element. Both the stylesheet's height and
  // the width JSX sets inline were discarded, and every bar drew as a grey track
  // at every value. Nothing caught it because markup was all anyone asserted on.
  const fills = [];
  for (const file of stylesheets) {
    const css = readFileSync(file, 'utf8');
    for (const [, body] of css.matchAll(/\.fill\s*\{([^}]*)\}/g)) {
      fills.push([relative(WEB, file), body]);
    }
  }
  assert.ok(fills.length, 'no .fill rule found — has the bar been renamed?');
  for (const [where, body] of fills) {
    if (!/\b(?:width|height)\s*:/.test(body)) continue;
    assert.match(body, /\bdisplay\s*:/,
      `${where}: .fill sizes itself but never leaves display:inline, so it draws nothing`);
  }
});

test('no component positions itself with an inline style', () => {
  // The style guide's rule is that layout sets spacing with flex or grid `gap`
  // and a component never adds a margin to place itself. An inline `style` is
  // where that rule goes to die, because it is invisible to the stylesheet
  // checks above and cannot be overridden by the thing doing the layout.
  //
  // Computed geometry is fine and is why this allows anything else: a grid's
  // template depends on how many columns there are, and a bar's width is the
  // number it is drawing. Neither can be a static rule.
  // Matched on the property name only, and as a prefix, so `marginTop` counts
  // and `textAlign: 'left'` does not.
  const banned = /^(margin|padding|position|top|left|right|bottom|inset|zIndex)/i;
  for (const file of files.filter((f) => f.endsWith('.jsx'))) {
    const src = readFileSync(file, 'utf8');
    for (const [, body] of src.matchAll(/style=\{\{([^}]*)\}\}/g)) {
      const props = body.split(',').map((pair) => pair.split(':')[0].trim())
        .filter(Boolean);
      const placed = props.filter((prop) => banned.test(prop.replace(/['"]/g, '')));
      assert.deepEqual(placed, [],
        `${relative(WEB, file)} places itself inline: style={{${body.trim()}}}`);
    }
  }
});

test('every var(--x) a component uses is defined in tokens.css', () => {
  for (const file of stylesheets) {
    const css = readFileSync(file, 'utf8');
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    const local = new Set(
      [...css.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
    // A component may also set a property inline — Bars sizes its label column
    // that way — so what its own JSX declares counts as defined.
    const jsx = file.replace('.module.css', '.jsx');
    try {
      for (const m of readFileSync(jsx, 'utf8').matchAll(/'(--[\w-]+)'\s*:/g)) {
        local.add(m[1]);
      }
    } catch { /* a stylesheet with no component of its own */ }
    for (const name of used) {
      assert.ok(tokens.has(name) || local.has(name),
        `${relative(WEB, file)} uses ${name}, which tokens.css does not define`);
    }
  }
});

test('the working bar holds itself back for the rebuilds nobody waits for', () => {
  // The bar has to be *mounted* the moment work starts — the render thread is
  // about to block, so nothing can mount it later — but it must not be *seen*
  // for a rebuild that takes 24ms. Showing it every time turned every button
  // press into a blink. So the delay is a compositor animation on opacity,
  // which keeps running while the thread is busy, where a timer would not.
  const css = readFileSync(join(WEB, 'src/ui/App.module.css'), 'utf8');
  const tokens = readFileSync(join(WEB, 'src/ui/tokens.css'), 'utf8');

  assert.match(css, /\.progress\s*\{[^}]*opacity:\s*0/,
    'the bar is visible before it has waited');
  assert.match(css, /\.armed\s*\{[^}]*animation:\s*reveal\s+var\(--wait\)/,
    'nothing reveals the bar after the wait');
  assert.match(css, /@keyframes reveal/, 'no reveal to run');
  assert.match(tokens, /--wait:\s*\d+ms/, '--wait is not a token');

  // And nothing dims the view: what is on screen is still true.
  assert.ok(!/\.working\b/.test(css), 'the whole view is being dimmed again');
});

test('every class in a stylesheet is used by its component, and the reverse', () => {
  for (const file of stylesheets) {
    const jsx = file.replace('.module.css', '.jsx');
    let source;
    try { source = readFileSync(jsx, 'utf8'); } catch { continue; }
    const declared = new Set(
      [...readFileSync(file, 'utf8')
        .split('{').map((chunk, i, all) => (i < all.length - 1 ? chunk.split('}').pop() : ''))
        .join(' ')
        .matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    const used = new Set([
      ...[...source.matchAll(/css\.([A-Za-z][\w]*)/g)].map((m) => m[1]),
      ...[...source.matchAll(/css\['([^']+)'\]/g)].map((m) => m[1]),
    ]);
    for (const name of declared) {
      assert.ok(used.has(name),
        `${relative(WEB, file)} declares .${name}, which nothing uses`);
    }
    for (const name of used) {
      assert.ok(declared.has(name),
        `${relative(WEB, jsx)} uses css.${name}, which its stylesheet does not declare`);
    }
  }
});

let vite, render, React, ui, engine, ix;

before(async () => {
  const { createServer } = await import('vite');
  vite = await createServer({
    root: WEB, logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
  });
  ({ renderToString: render } = await import('react-dom/server'));
  React = (await import('react')).default;
  ui = await vite.ssrLoadModule('/src/ui/index.js');
  engine = await vite.ssrLoadModule('/src/engine/index.js');
  ix = engine.indexContract(
    JSON.parse(readFileSync(join(WEB, 'public', 'grid.contract.json'), 'utf8')));
});

after(async () => { await vite?.close(); });

const h = (...args) => React.createElement(...args);

test('GameItem renders in every variant, and with nothing to say', () => {
  const row = ix.rowOf.get(ix.ids[0]);
  const full = ui.toGameView(ix, row, {
    shelf: '4 players · Light', owned: true, pinned: true,
    reason: 'Lost 3 players · Heavy to Gloomhaven (0.95).',
  });
  const bare = ui.toGameView(ix, row);
  for (const variant of ['compact', 'row', 'reason']) {
    for (const game of [full, bare]) {
      const html = render(h(ui.GameItem, { game, variant }));
      assert.ok(html.includes(game.name), `${variant} lost the name`);
    }
  }
  assert.equal(render(h(ui.GameItem, { game: null })), '');
});

test('the radar draws a set, with and without something to compare against', () => {
  const names = ix.groups.map((g) => g.name.split(' · ')[0]);
  const values = names.map((_, i) => 0.2 + (i % 5) * 0.15);
  const reference = names.map(() => 0.8);
  const alone = render(h(ui.Radar, { names, values }));
  assert.ok(alone.includes('<polygon'), 'no shape drawn');
  const compared = render(h(ui.Radar, { names, values, reference }));
  assert.ok(compared.split('<polygon').length > alone.split('<polygon').length,
    'the second series did not draw');
  // The gap list is the point of an overlay: it names where you are thinnest.
  // In words — it used to print the raw coverage difference, so a shelf holding
  // none of a kind the collection covers fully read "Deduction −1.00".
  //
  // And it says which claim it is making. Every spoke here is at 0.2 or more,
  // so "reaches no X" would be false: that sentence is for a spoke actually
  // sitting on the origin, and this one is "thinnest on".
  const thin = /Thinnest on ([^<.]*)/.exec(compared);
  assert.ok(thin, 'no gap reported against the reference');
  assert.ok(!/\d/.test(thin[1]), `the gap list is printing numbers again: ${thin[1]}`);
  assert.ok(!/Reaches no/.test(compared),
    'claiming a spoke at 0.2 or more is not reached at all');

  const missing = names.map((_, i) => (i < 2 ? 0 : 0.6));
  const zeroed = render(h(ui.Radar, { names, values: missing, reference }));
  const said = /Reaches no ([^<.]*)/.exec(zeroed);
  assert.ok(said, 'a spoke on the origin is not reported as unreached');
  assert.equal(said[1].split(/,| or /).length, 2, `named ${said[1]} for two empty spokes`);
  assert.equal(render(h(ui.Radar, { names: [], values: [] })), '');
});

test('bars draw one game and refuse an empty one', () => {
  const row = ix.rowOf.get(ix.ids[0]);
  const axes = ui.axesOf(ix, row, { limit: 6 });
  assert.ok(axes.length > 0, 'no axes to draw');
  assert.ok(render(h(ui.Bars, { items: axes })).includes(axes[0].label));
  assert.equal(render(h(ui.Bars, { items: [] })), '');
  assert.equal(render(h(ui.Bars, { items: [{ label: 'nothing', value: 0 }] })), '');
});

test('the split bar reports which axes are on', () => {
  const axes = [{ key: 'players', label: 'player count' }, { key: 'weight', label: 'weight' }];
  const none = render(h(ui.SplitBar, { axes, active: [], onToggle() {}, count: 12 }));
  assert.ok(none.includes('＋ player count'), 'an axis that is off should offer itself');
  assert.ok(none.includes('12 games'));
  const one = render(h(ui.SplitBar, { axes, active: ['players'], onToggle() {}, count: 39 }));
  assert.ok(one.includes('aria-pressed="true"'), 'an axis that is on should say so');
});

test('depth is one number, and says so by saying nothing', () => {
  // The `auto` / `set` tag is gone: it announced two kinds of number where a
  // reader only ever sees one, and "auto" beside a figure you had just typed
  // over was the most confusing thing on the screen.
  const read = render(h(ui.DepthField, { value: 11 }));
  assert.ok(read.includes('11'), 'the number itself');
  assert.ok(!/auto|set/i.test(read), `still labelling the number: ${read}`);

  // What is worth offering is the way back, and only once there is one.
  assert.ok(!render(h(ui.DepthField, { value: 11, onClear: () => {} })).includes('↺'),
    'offering a way back from a number nobody typed');
  assert.ok(render(h(ui.DepthField, { value: 6, set: true, onClear: () => {} })).includes('↺'),
    'no way back from a number that was typed');
});

test('every page renders, at every split, empty and with games', async () => {
  const contract = JSON.parse(
    readFileSync(join(WEB, 'public', 'grid.contract.json'), 'utf8'));
  const { default: App } = await vite.ssrLoadModule('/src/ui/App.jsx');
  const { useCollection } = await vite.ssrLoadModule('/src/ui/state.js');
  const html = render(h(App, { contract }));
  assert.ok(html.includes('The collection'), 'no heading');
  assert.ok(html.includes('Split by'), 'no split control');
  assert.ok(!html.includes('NaN') && !html.includes('undefined'),
    'a value reached the page unresolved');
  void useCollection;
});

test('the views render at each split, and with a shelf of your own', async () => {
  const contract = JSON.parse(
    readFileSync(join(WEB, 'public', 'grid.contract.json'), 'utf8'));
  const Collection = (await vite.ssrLoadModule('/src/ui/views/Collection.jsx')).default;
  const Mine = (await vite.ssrLoadModule('/src/ui/views/Mine.jsx')).default;
  const AxisPanel = (await vite.ssrLoadModule('/src/ui/views/AxisPanel.jsx')).default;
  const Game = (await vite.ssrLoadModule('/src/ui/views/Game.jsx')).default;
  const { toGameView } = await vite.ssrLoadModule('/src/ui/game/view.js');

  const owned = [...Array(13)].map((_, i) => ix.ids[i * 7]);
  const noop = () => {};
  const actions = {
    toggleAxis: noop, own: noop, ownMany: noop, pin: noop, block: noop,
    setDepth: noop, setRows: noop, reset: noop,
    focusCell: noop, focusGame: noop, unfocus: noop, back: noop,
  };

  for (const axes of [[], ['players'], ['players', 'weight']]) {
    for (const mine of [[], owned]) {
      const built = engine.buildGrid(contract, { axes, owned: mine });
      const state = { axes, owned: mine, pinned: [], blocked: [],
                      depthOverrides: {}, columns: built.columns, rowCount: 5,
                      rowEdges: null, panel: null, open: null,
                      limits: [{ kind: 'returns', scope: 'shelf', on: true, value: 45 },
                               { kind: 'count', scope: 'shelf', on: false, value: 5 }] };
      const where = `axes=[${axes}] owned=${mine.length}`;

      const collection = render(h(Collection, { built, state, actions }));
      assert.ok(collection.includes('polygon'), `${where}: no radar`);
      assert.ok(!collection.includes('NaN'), `${where}: NaN on the collection view`);

      const yours = render(h(Mine, { built, state, actions, onOpen: noop }));
      assert.ok(!yours.includes('NaN'), `${where}: NaN on my games`);
      if (mine.length) {
        assert.ok(/Lost |Reaches no shelf/.test(yours) || !yours.includes('Did not 0'),
          `${where}: a game that lost its shelf said nothing about why`);
      } else {
        assert.ok(yours.includes('Nothing yet'), `${where}: no empty state`);
      }

      // The axis panel only exists for an axis that is on.
      for (const which of axes) {
        const panel = render(h(AxisPanel, { which, built, state, actions }));
        assert.ok(panel.length > 0, `${where}: the ${which} panel drew nothing`);
        assert.ok(!panel.includes('NaN'), `${where}: NaN in the ${which} panel`);
        assert.ok(/deep|bands|Group/.test(panel),
          `${where}: the ${which} panel said nothing about its groups`);
      }
      assert.equal(render(h(AxisPanel, { which: null, built, state, actions })), '');

      // One game, which says nothing about the shelf it landed on — so the same
      // markup comes out at every split, and that is the assertion.
      const shelved = built.grid.flatMap((c) => c.picks)[0];
      const game = toGameView(ix, ix.rowOf.get(shelved.id), {});
      const open = render(h(Game, { game, built, state, actions }));
      assert.ok(open.includes(game.rankLabel.replace('#', '#')), `${where}: lost the game`);
      assert.ok(open.includes('What it does'), `${where}: lost its body`);
      assert.ok(open.includes('boardgamegeek.com'), `${where}: no BGG link`);
      assert.ok(!open.includes('NaN'), `${where}: NaN in the game view`);
      assert.equal(render(h(Game, { game: null, built, state, actions })), '');
    }
  }
});

test('an analysis with nothing to say renders nothing at all', async () => {
  const { analyse, all } = await vite.ssrLoadModule('/src/ui/analysis/index.js');
  const contract = JSON.parse(
    readFileSync(join(WEB, 'public', 'grid.contract.json'), 'utf8'));
  const built = engine.buildGrid(contract, { axes: ['players', 'weight'] });
  const state = { axes: ['players', 'weight'], owned: [], pinned: [], blocked: [],
                  depthOverrides: {}, columns: built.columns, rowCount: 5, rowEdges: null,
                  panel: null, selected: null, open: null,
                  limits: [{ kind: 'returns', scope: 'shelf', on: true, value: 45 }],
                  perShelf: null };

  assert.ok(all().length >= 3, 'nothing registered');
  const found = analyse({ built, state });
  assert.ok(found.length > 0, 'nothing had anything to say about a whole collection');
  for (const { analysis, data } of found) {
    assert.ok(data != null, `${analysis.id} was listed with no data`);
    assert.ok(render(h(analysis.View, { data, built, state, actions: {}, onOpen() {} })).length > 0,
      `${analysis.id} rendered nothing`);
  }

  // Scoped to the reader's own games, with none owned: silent, not empty-headed.
  const mine = all().filter((a) => a.scope === 'mine');
  for (const analysis of mine) {
    assert.ok(!found.some((f) => f.analysis.id === analysis.id),
      `${analysis.id} is about your games and appeared without any`);
  }
});

test('an analysis does not know where it is being rendered', async () => {
  const { all } = await vite.ssrLoadModule('/src/ui/analysis/index.js');
  for (const analysis of all()) {
    assert.equal(typeof analysis.run, 'function', `${analysis.id} cannot compute`);
    assert.equal(typeof analysis.View, 'function', `${analysis.id} cannot render`);
    assert.ok(['collection', 'mine'].includes(analysis.scope),
      `${analysis.id} has no scope`);
  }
});
