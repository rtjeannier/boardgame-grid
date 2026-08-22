/**
 * Mount the app for real, click things, and see what happens.
 *
 * Server rendering proves a component does not throw on the way in. It does not
 * run an effect, a portal, or a click handler — and every interface bug this
 * project has shipped was in one of those. The drawer only appears through
 * `createPortal(…, document.body)`, and the last one to do that was covered by
 * the settings panel because nothing ever opened it outside a browser.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');

let vite, React, act, createRoot, App, contract, dom;

before(async () => {
  const { JSDOM } = await import('jsdom');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });
  // `navigator` is a getter on modern Node, so it is defined rather than assigned.
  for (const key of ['window', 'document', 'HTMLElement', 'Node',
                     'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle']) {
    globalThis[key] = dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator',
    { value: dom.window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { createServer } = await import('vite');
  vite = await createServer({
    root: WEB, logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
  });
  React = (await import('react')).default;
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  ({ default: App } = await vite.ssrLoadModule('/src/ui/App.jsx'));
  contract = JSON.parse(readFileSync(join(WEB, 'public', 'grid.contract.json'), 'utf8'));
});

after(async () => { await vite?.close(); dom?.window?.close(); });

function mount() {
  const host = document.getElementById('root');
  const root = createRoot(host);
  act(() => root.render(React.createElement(App, { contract })));
  return { host, root };
}

const byText = (text, within = document) =>
  [...within.querySelectorAll('button, a, [role="button"]')]
    .find((el) => el.textContent.trim() === text);

const click = (el) => act(() => el.dispatchEvent(
  new dom.window.MouseEvent('click', { bubbles: true })));

test('it opens on the collection, with no grid at all', () => {
  const { host, root } = mount();
  assert.match(host.textContent, /The collection/);
  // Twelve, read off the curve rather than set by anyone.
  assert.match(host.textContent, /12 games/);
  assert.match(host.textContent, /Brass: Birmingham/);
  assert.ok(host.querySelector('svg polygon'), 'the radar did not draw');
  act(() => root.unmount());
});

test('splitting reshapes the same collection', () => {
  const { host, root } = mount();
  const players = byText('＋ player count', host);
  assert.ok(players, 'no control to split by player count');
  click(players);
  assert.match(host.textContent, /One shelf per group/);
  // 5+6+11+5+10+3+1: four players declines the reading and falls back to five.
  assert.match(host.textContent, /41 games/);

  click(byText('＋ weight', host));
  assert.match(host.textContent, /Thirty-five shelves/);
  assert.match(host.textContent, /176 games/);

  // And back to one shelf, which is the same object at a different setting.
  click([...host.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-pressed') === 'true'));
  act(() => root.unmount());
});

test('the drawer opens over the page and closes on Escape', () => {
  const { host, root } = mount();
  const row = [...host.querySelectorAll('[role="button"]')]
    .find((el) => el.textContent.includes('Brass: Birmingham'));
  assert.ok(row, 'no game to open');
  click(row);

  // Portaled onto document.body, so it is outside the app's own subtree.
  const drawer = document.querySelector('[role="dialog"]');
  assert.ok(drawer, 'the drawer did not open');
  assert.match(drawer.textContent, /What it does/);
  assert.match(drawer.textContent, /Closest to it in the collection/);
  assert.equal(document.body.style.overflow, 'hidden', 'the page still scrolls behind it');

  act(() => document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Escape did not close it');
  assert.notEqual(document.body.style.overflow, 'hidden', 'the scroll lock was left on');
  act(() => root.unmount());
});

test('adding a game reshapes the collection and the radar gains a second shape', () => {
  const { host, root } = mount();
  click(byText('My games', host));
  assert.match(host.textContent, /Nothing yet/);

  const search = host.querySelector('input[aria-label="Search for a game"]');
  assert.ok(search, 'no search field');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(search, 'wingspan');
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const hit = [...host.querySelectorAll('button')]
    .find((b) => b.textContent.includes('Wingspan'));
  assert.ok(hit, 'searching found nothing');
  click(hit);

  assert.match(host.textContent, /Wingspan/);
  assert.ok(/Hold a place 1|Did not 1/.test(host.textContent),
    'the game was added but nothing said what became of it');

  click(byText('Collection', host));
  const shapes = host.querySelectorAll('svg polygon');
  // Rings plus two shapes: yours drawn against what the collection reaches.
  assert.ok(shapes.length >= 6, `expected an overlay, got ${shapes.length} polygons`);
  assert.match(host.textContent, /Yours against the collection/);
  act(() => root.unmount());
});

test('pinning a game keeps it, blocking one removes it', () => {
  const { host, root } = mount();
  const before = host.textContent.includes('Brass: Birmingham');
  assert.ok(before, 'the top game was not there to begin with');

  const block = [...host.querySelectorAll('button[aria-label^="Block"]')][0];
  assert.ok(block, 'no block control on the register');
  click(block);
  assert.ok(!host.textContent.includes('Brass: Birmingham'),
    'a blocked game is still in the collection');

  act(() => root.unmount());
});
