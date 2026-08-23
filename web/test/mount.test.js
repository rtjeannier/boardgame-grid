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

/** The collection's size, from the bar — not from whatever prose says "N games". */
const size = (host) => {
  const chip = [...host.querySelectorAll('span')]
    .filter((el) => /^\d+ games$/.test(el.textContent.trim()))
    .pop();
  return chip ? Number(chip.textContent.trim().split(' ')[0]) : null;
};

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
  // 5+6+9+9+10+3+1, each column stopping where its own returns fall away.
  assert.match(host.textContent, /43 games/);

  click(byText('＋ weight', host));
  assert.match(host.textContent, /Thirty-five shelves/);
  assert.match(host.textContent, /190 games/);

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
  assert.match(drawer.textContent, /Games like it/);
  assert.ok(drawer.querySelector('a[href^="https://boardgamegeek.com/boardgame/"]'),
    'no link back to BoardGameGeek');
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

test('blocking says what it did, lists what is blocked, and can be undone', () => {
  const { host, root } = mount();
  const register = () => host.querySelector('table, [class*="list"]')?.textContent
    ?? host.textContent;
  assert.ok(register().includes('Brass: Birmingham'), 'nothing to block');

  const block = [...host.querySelectorAll('button[aria-label^="Block"]')][0];
  assert.ok(block, 'no block control on the register');
  click(block);

  // Three things have to be true, and only the first used to be.
  assert.ok(!register().includes('Brass: Birmingham'), 'it is still shelved');
  assert.match(host.textContent, /Blocked/, 'nothing said what happened');
  assert.match(host.textContent, /In: |Nothing took its place/,
    'it never said what came in instead');

  // The record of what is blocked is a count you open, not a list in the way.
  const summary = [...host.querySelectorAll('summary')]
    .find((el) => /\d+ blocked/.test(el.textContent));
  assert.ok(summary, 'no blocked count in the bar');
  act(() => { summary.parentElement.open = true; });

  const unblock = host.querySelector('button[aria-label^="Unblock"]');
  assert.ok(unblock, 'no way to take a game off the blocked list');
  click(unblock);
  assert.ok(register().includes('Brass: Birmingham'), 'unblocking did not restore it');
  act(() => root.unmount());
});

test('a pin stays visible once it is set', () => {
  const { host, root } = mount();
  const pin = [...host.querySelectorAll('button[aria-label^="Pin"]')][0];
  assert.ok(pin, 'no pin control');
  click(pin);
  const pressed = [...host.querySelectorAll('button[aria-pressed="true"]')]
    .filter((b) => (b.getAttribute('aria-label') || '').startsWith('Unpin'));
  assert.equal(pressed.length, 1, 'the pin did not stay set');
  assert.match(host.textContent, /Pinned/, 'nothing said what pinning does');
  act(() => root.unmount());
});

test('an axis opens its own settings, in front of the shelves it describes', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));

  // The chip has two jobs now: the body opens the panel, the ✕ turns the axis
  // off. Clicking the body must not remove the split.
  const body = [...host.querySelectorAll('button')]
    .find((b) => b.textContent.startsWith('player count'));
  click(body);
  assert.match(host.textContent, /Player groups/);
  assert.match(host.textContent, /How deep each one goes/);
  assert.match(host.textContent, /deep/, 'the panel did not report what it read');
  assert.match(host.textContent, /43 games/, 'opening the panel changed the collection');

  // Player groups get the same stepper the weight bands have.
  const groups = () => host.querySelectorAll('input[aria-label="Group name"]').length;
  const was = groups();
  click(host.querySelector('button[aria-label="More groups"]'));
  assert.equal(groups(), was + 1, 'adding a group did nothing');
  click(host.querySelector('button[aria-label="Fewer groups"]'));
  assert.equal(groups(), was, 'removing a group did nothing');

  const remove = [...host.querySelectorAll('button[aria-label^="Remove"]')].pop();
  click(remove);
  assert.equal(groups(), was - 1, 'the ✕ on a group did nothing');
  act(() => root.unmount());
});

test('the weight panel adds and removes bands', () => {
  const { host, root } = mount();
  click(byText('＋ weight', host));
  const body = [...host.querySelectorAll('button')]
    .find((b) => b.textContent.startsWith('weight'));
  click(body);
  assert.match(host.textContent, /Weight bands/);
  assert.match(host.textContent, /Gateway/);

  const fewer = host.querySelector('button[aria-label="Fewer bands"]');
  assert.ok(fewer, 'no way to take a band away');
  const bands = () => [...host.querySelectorAll('input[aria-label^="Top of"]')]
    .map((i) => i.getAttribute('aria-label').replace('Top of ', ''));
  assert.equal(bands().length, 4, 'five bands have four editable edges');
  click(fewer);
  assert.equal(bands().length, 3, 'a band was removed but the edges did not follow');
  // The ladder spreads rather than truncating, so the heaviest band is still
  // called Heavy instead of the last name being quietly dropped.
  assert.deepEqual(bands(), ['Gateway', 'Light', 'Medium-Heavy']);
  assert.match(host.textContent, /Heavy/);
  act(() => root.unmount());
});

test('build-on-mine needs games, then holds all of them and fills around', () => {
  const { host, root } = mount();
  const only = () => byText('Build on mine', host);
  assert.ok(only().disabled, 'offered before there was anything to filter to');

  click(byText('My games', host));
  const search = host.querySelector('input[aria-label="Search for a game"]');
  for (const term of ['gloomhaven', 'azul']) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, term);
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const hit = [...host.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith(term[0].toUpperCase()));
    if (hit) click(hit);
  }

  click(byText('Collection', host));
  assert.ok(!only().disabled, 'still refused with games added');
  const before = size(host);
  click(only());
  assert.match(host.textContent, /holds a place, and the rest/);
  // Not a filter: the collection is still a whole collection, with yours in it.
  const after = size(host);
  assert.ok(after >= before,
    `building on ${before} games should not shrink the collection to ${after}`);
  assert.match(host.textContent, /Gloomhaven/, 'a game that was added is not held');
  act(() => root.unmount());
});

test('an empty collection is a state, not a crash', () => {
  const { host, root } = mount();
  const depth = host.querySelector('input[aria-label="Games on this shelf"]');
  assert.ok(depth, 'the collection has no depth to clear');

  const type = (value) => act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(depth, value);
    depth.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  type('');                                     // this used to throw
  assert.match(host.textContent, /Empty\./, 'no empty state');
  assert.match(host.textContent, /Add Brass: Birmingham/,
    'an empty collection should offer the best game there is');
  assert.ok(!host.textContent.includes('NaN'));

  // And back up again, one game at a time, naming each.
  click(byText('＋ Add Brass: Birmingham', host));
  assert.match(host.textContent, /Add Gloomhaven/, 'the button did not move on');
  act(() => root.unmount());
});

test('the radar redraws when the collection changes', () => {
  const { host, root } = mount();
  const shape = () => {
    const all = [...host.querySelectorAll('svg polygon')];
    return all[all.length - 1]?.getAttribute('points');
  };
  const before = shape();
  assert.ok(before, 'no radar to begin with');

  click([...host.querySelectorAll('button[aria-label^="Block"]')][0]);
  assert.notEqual(shape(), before, 'the radar kept the shape of a collection that changed');
  act(() => root.unmount());
});

test('a shelf, a column and a row can each be changed where they are drawn', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  click(byText('＋ weight', host));

  const columns = () => host.querySelectorAll('button[aria-label^="Drop the"][aria-label$="column"]').length;
  const wasCols = columns();
  assert.ok(wasCols > 1, 'no columns to drop');

  // One shelf's depth, set on that shelf, without touching its neighbours.
  const cellCount = () => host.querySelectorAll('button[aria-label="One more here"]').length;
  assert.ok(cellCount() > 0, 'no per-shelf control');
  const before = host.textContent.match(/(\d+) games/)[1];
  click(host.querySelector('button[aria-label="One more here"]'));
  const after = host.textContent.match(/(\d+) games/)[1];
  assert.equal(Number(after), Number(before) + 1, 'one more on one shelf is one more game');

  click(host.querySelector('button[aria-label^="Drop the"][aria-label$="column"]'));
  assert.equal(columns(), wasCols - 1, 'dropping a column did nothing');

  const bands = () => host.querySelectorAll('button[aria-label^="Drop the"][aria-label$="band"]').length;
  const wasBands = bands();
  click(host.querySelector('button[aria-label^="Drop the"][aria-label$="band"]'));
  assert.equal(bands(), wasBands - 1, 'dropping a band did nothing');

  // And back, from the ＋ that sits where the new one appears.
  click(host.querySelector('button[aria-label="Add a weight band"]'));
  assert.equal(bands(), wasBands, 'adding a band did nothing');
  click(host.querySelector('button[aria-label="Add a player group"]'));
  assert.equal(columns(), wasCols, 'adding a column did nothing');
  act(() => root.unmount());
});

test('adding a band splits the widest rather than re-cutting them all', () => {
  const { host, root } = mount();
  click(byText('＋ weight', host));
  const edges = () => [...host.querySelectorAll('input[aria-label^="Top of"]')]
    .map((i) => Number(i.defaultValue ?? i.value));
  const body = [...host.querySelectorAll('button')]
    .find((b) => b.textContent.startsWith('weight'));
  click(body);
  const was = edges();
  click(host.querySelector('button[aria-label="More bands"]'));
  const now = edges();
  assert.equal(now.length, was.length + 1, 'no new edge');
  // Every edge the reader could have set is still there; only one was added.
  for (const edge of was) {
    assert.ok(now.includes(edge), `edge ${edge} was thrown away`);
  }
  act(() => root.unmount());
});

test('pinning a game that already holds a place changes nothing', () => {
  const { host, root } = mount();
  const list = () => [...host.querySelectorAll('[class*="entry"]')]
    .map((e) => e.textContent.split('#')[0]).join('|');
  const before = list();
  const pin = [...host.querySelectorAll('button[aria-label^="Pin"]')][0];
  click(pin);
  assert.equal(list(), before,
    'pinning something already shelved reshuffled the collection');
  act(() => root.unmount());
});

test('the next best game is offered at every split, and lands where it says', () => {
  const { host, root } = mount();
  const offer = () => (host.textContent.match(/＋ Add ([^\n]+?)(?:Goes on|Adds)/) ?? [])[1];

  assert.ok(byText(`＋ Add ${offer()}`, host), 'nothing offered unsplit');
  const unsplit = offer();

  click(byText('＋ player count', host));
  click(byText('＋ weight', host));
  const split = offer();
  assert.ok(split, 'the grid offered nothing to add');
  // Split, the offer names the shelf it would go on — the same question, asked
  // of thirty-five shelves instead of one.
  assert.match(host.textContent, /Goes on .+ · /, 'it did not say which shelf');

  const before = size(host);
  click(byText(`＋ Add ${split}`, host));
  assert.equal(size(host), before + 1,
    'pressing it did not add a game');
  assert.ok(host.textContent.includes(split.trim()), 'the game it named is not there');
  void unsplit;
  act(() => root.unmount());
});

test('fill until a number of games, and the collection follows', () => {
  const { host, root } = mount();
  const open = [...host.querySelectorAll('summary')]
    .find((el) => el.textContent.includes('Fill until'));
  assert.ok(open, 'no fill rule in the bar');
  act(() => { open.parentElement.open = true; });

  // The two that cannot work yet say why rather than being hidden.
  const blocked = [...host.querySelectorAll('button[disabled]')]
    .filter((b) => /budget|shelf space/.test(b.textContent));
  assert.equal(blocked.length, 2, 'budget and shelf space should be offered and disabled');
  assert.match(blocked.map((b) => b.textContent).join(' '), /no price|no box size/);

  click([...host.querySelectorAll('button')].find((b) => b.textContent.includes('a number of games')));
  const field = host.querySelector('input[aria-label="How many games"]');
  assert.ok(field, 'no number to set');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(field, '7');
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(size(host), 7, 'the collection did not follow the number');
  act(() => root.unmount());
});

test('held twice is empty until something really is', () => {
  const { host, root } = mount();
  // The twelve-game collection has no duplicate in it by construction.
  assert.ok(!host.textContent.includes('Held twice'),
    'a collection built to avoid duplication reported one');

  const add = (term, name) => {
    click(byText('My games', host));
    const search = host.querySelector('input[aria-label="Search for a game"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, term);
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const hit = [...host.querySelectorAll('button')]
      .find((b) => b.textContent.startsWith(name));
    if (hit) click(hit);
  };
  add('gloomhaven', 'Gloomhaven');
  add('jaws of the lion', 'Gloomhaven: Jaws of the Lion');

  click(byText('Collection', host));
  click(byText('Build on mine', host));
  assert.match(host.textContent, /Held twice/, 'a real duplicate went unreported');
  // The more contained side is the one named, not whichever came first.
  assert.match(host.textContent,
    /Jaws of the Lion[^]*?Gloomhaven already covers \d+%/,
    'it named the wrong half of the pair');
  act(() => root.unmount());
});
