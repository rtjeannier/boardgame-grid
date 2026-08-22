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

test('every class in a stylesheet is used by its component, and the reverse', () => {
  for (const file of stylesheets) {
    const jsx = file.replace('.module.css', '.jsx');
    let source;
    try { source = readFileSync(jsx, 'utf8'); } catch { continue; }
    const declared = new Set(
      [...readFileSync(file, 'utf8').matchAll(/^\.([A-Za-z][\w-]*)/gm)].map((m) => m[1]));
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
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
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
    carries: 0.095, shelf: '4 players · Light', owned: true, pinned: true,
    reason: 'Lost 3 players · Heavy to Gloomhaven (0.95).',
  });
  const bare = ui.toGameView(ix, row);
  for (const variant of ['compact', 'row', 'reason', 'expanded']) {
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
  assert.ok(compared.includes('−'), 'no gap reported against the reference');
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

test('depth says whether it read the number or was told it', () => {
  assert.ok(render(h(ui.DepthField, { value: 11, auto: 11 })).includes('auto'));
  assert.ok(render(h(ui.DepthField, { value: 6, auto: 3 })).includes('auto said 3'));
});
