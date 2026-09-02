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
  // A size read off the curve rather than set by anyone, so the test does not
  // spell it — nor the names, which belong to whatever corpus is shipped. What
  // it checks is that the number on the screen and the games on it agree.
  const shown = size(host);
  assert.ok(shown > 0, 'the collection opened empty');
  // The first `.picks` is the shelf itself; the second is its on-deck list.
  assert.equal(
    host.querySelector('[class*="picks"]').querySelectorAll(':scope > [class*="_item_"]').length,
    shown, 'the count and the games under it disagree');
  assert.match(host.textContent, /the collection/);
  assert.ok(host.querySelector('svg polygon'), 'the radar did not draw');
  act(() => root.unmount());
});

test('splitting reshapes the same collection', () => {
  const { host, root } = mount();
  const players = byText('＋ player count', host);
  assert.ok(players, 'no control to split by player count');
  const before = size(host);
  click(players);
  assert.match(host.textContent, /One shelf per group/);
  // Splitting deals the collection out; it does not choose a new one. This used
  // to allocate again from the whole corpus, so twelve games became fifty-eight
  // of which forty-seven had never been in the collection.
  assert.equal(size(host), before,
    `splitting by players went ${before} -> ${size(host)} games`);

  click(byText('＋ weight', host));
  assert.match(host.textContent, /35 shelves/);
  assert.equal(size(host), before, 'splitting again changed what the collection holds');

  // Growing it is a thing you ask for, and it is additive.
  const fit = byText('Fit the shelves', host);
  assert.ok(fit, 'a dealt grid offers nothing to fill it with');
  click(fit);
  assert.ok(size(host) > before, `filling gave ${size(host)}, against ${before}`);
  assert.equal(byText('Fit the shelves', host), undefined,
    'a fitted grid still offers to fit itself');

  // And back to one shelf, which is the same object at a different setting.
  click([...host.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-pressed') === 'true'));
  act(() => root.unmount());
});

test('changing the grid\'s shape offers to fit it again', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  click(byText('＋ weight', host));
  click(byText('Fit the shelves', host));
  const settled = size(host);
  assert.equal(byText('Fit the shelves', host), undefined, 'a fitted grid is not settled');

  // Dropping a band packs the same games into fewer shelves, so they end up
  // *over* what their curves read rather than under. The prompt used to count
  // only the shortfall, so it went silent exactly here: you could drop a row
  // and be offered nothing at all.
  const drop = [...host.querySelectorAll('button')]
    .find((b) => /^Drop the .* band$/.test(b.getAttribute('aria-label') ?? ''));
  assert.ok(drop, 'no way to drop a band');
  click(drop);
  assert.equal(size(host), settled, 'dropping a band changed what the collection holds');

  const again = byText('Fit the shelves', host);
  assert.ok(again, 'dropping a band offered no way to fit the grid to its new shape');
  assert.match(host.textContent, /hold more than they read/);
  click(again);
  assert.ok(size(host) < settled, `fitting left ${size(host)} of ${settled} in place`);
  assert.equal(byText('Fit the shelves', host), undefined, 'still out of shape after fitting');
  act(() => root.unmount());
});

/**
 * jsdom does no layout, so a viewport is a promise about `matchMedia` and
 * nothing else. That is enough: the reflow is a decision made from a media
 * query, not from anything measured.
 */
function atWidth(px, run) {
  const real = dom.window.matchMedia;
  dom.window.matchMedia = (q) => {
    const m = /max-width:\s*(\d+)px/.exec(q);
    return { matches: m ? px <= Number(m[1]) : false, media: q,
             addEventListener() {}, removeEventListener() {},
             addListener() {}, removeListener() {} };
  };
  try { return run(); } finally { dom.window.matchMedia = real; }
}

test('a narrow window reflows the grid rather than crushing it', () => {
  // Measured on the seven-column board, the room a game's name gets: 17
  // characters at 1440px, 13 at 1280, 7 at 1024, 4 at 900, and at 768 and below
  // the board is narrower than its own row heads and add strip, so the columns
  // resolve to zero. Four characters of a title is not a smaller title, so the
  // matrix reflows into a list — reflow before shrinking, and never truncate.
  const shelvesIn = (host) => [...host.querySelectorAll('[class*="_mini_"]')];
  const namesIn = (host) => shelvesIn(host)
    .flatMap((el) => [...el.querySelectorAll('[class*="_compact_"] [class*="_name_"]')])
    .map((n) => n.textContent.trim());

  for (const [px, wants] of [[1440, 'matrix'], [900, 'matrix'], [768, 'stack'], [390, 'stack']]) {
    atWidth(px, () => {
      const { host, root } = mount();
      click(byText('＋ player count', host));
      click(byText('＋ weight', host));
      const fit = byText('Fit the shelves', host);
      if (fit) click(fit);

      const stacked = !!host.querySelector('[class*="_stack_"]');
      const matrix = !!host.querySelector('[class*="_board_"]');
      assert.equal(stacked ? 'stack' : matrix ? 'matrix' : 'neither', wants,
        `at ${px}px the board should be a ${wants}`);

      // Either way every shelf is still there, and names are never dropped.
      assert.equal(shelvesIn(host).length, 35, `at ${px}px a shelf went missing`);
      const names = namesIn(host);
      assert.ok(names.length > 20, `at ${px}px only ${names.length} games were named`);
      assert.ok(names.every((n) => n && !n.endsWith('…')),
        `at ${px}px a name was truncated in the markup`);
      act(() => root.unmount());
    });
  }
});

test('it says it is working before it starts working', async () => {
  const { host, root } = mount();
  // Deliberately not wrapped in `act`: `act` flushes the transition to
  // completion, which is exactly the state this is about not being in. The
  // point of the transition is that React paints the tree it already has, with
  // the bar on it, *before* it starts the render that blocks the thread —
  // rebuilding is one synchronous task, so a bar started when the work begins
  // never gets a frame to appear in.
  const working = () => {
    const strip = host.querySelector('[role="status"]');
    return !!(strip && strip.children.length);
  };
  assert.equal(working(), false, 'it claims to be working before anything happened');

  const split = byText('＋ player count', host);
  split.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(working(), true, 'no sign it was working');

  await new Promise((r) => setTimeout(r, 500));
  assert.equal(working(), false, 'it never stopped saying it was working');
  assert.match(host.textContent, /One shelf per group/, 'the work did not land');
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

/**
 * Open a shelf. Its controls are not on the grid any more — a two-axis grid
 * carried 110 of them, seventy being the same stepper once per cell — so
 * reaching a shelf's depth means opening the shelf, the way a reader does.
 */
function openShelf(host, pick = (els) => els[0]) {
  const shelves = [...host.querySelectorAll('button[aria-label^="Open "]')];
  const target = pick(shelves);
  if (target) click(target);
  // Portaled onto document.body, so it is outside the app's own subtree.
  return target && document.querySelector('[role="dialog"]');
}

test('blocking says what it did, lists what is blocked, and can be undone', () => {
  const { host, root } = mount();
  const register = () => host.querySelector('[class*="picks"]')?.textContent
    ?? host.textContent;
  const top = host.querySelector('[class*="picks"] [class*="name"]')?.textContent.trim();
  assert.ok(top && register().includes(top), 'nothing to block');

  const block = host.querySelector('[class*="picks"] button[aria-label^="Block"]');
  assert.ok(block, 'no block control on the shelf');
  click(block);

  // Three things have to be true, and only the first used to be.
  assert.ok(!register().includes(top), 'it is still shelved');
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
  assert.ok(register().includes(top), 'unblocking did not restore it');
  act(() => root.unmount());
});

test('a pin stays visible once it is set, wherever the game is drawn', () => {
  const { host, root } = mount();
  const pin = [...host.querySelectorAll('button[aria-label^="Pin"]')][0];
  assert.ok(pin, 'no pin control');
  const name = pin.getAttribute('aria-label').replace('Pin ', '');
  click(pin);
  const pressed = [...host.querySelectorAll('button[aria-pressed="true"]')]
    .filter((b) => (b.getAttribute('aria-label') || '').startsWith('Unpin'));
  assert.ok(pressed.length >= 1, 'the pin did not stay set');
  // One game can legitimately be drawn twice — the first pin the rail offers is
  // the runner-up, which is *not* on a shelf, so pinning it puts it on one and
  // also lists it under "only here because you pinned it". Both rows are the
  // same game and both are set; a second *name* would be the bug.
  assert.deepEqual([...new Set(pressed.map((b) => b.getAttribute('aria-label')))],
    [`Unpin ${name}`], 'a pin set something other than the game it named');
  assert.match(host.textContent, /Pinned/, 'nothing said what pinning does');
  act(() => root.unmount());
});

test('a shelf carries its controls under it, not in a header over it', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));

  // The stepper comes after the games it counts, in document order — which is
  // the whole of "no header". A cell's top is its name or nothing.
  //
  // Bounded to one shelf. Two looser versions of this were wrong in opposite
  // directions: matching the first thing that "looked like a game" caught a
  // rank in the rail and held even with the foot put back on top, and walking
  // up from the stepper for an ancestor with games in it escaped an empty
  // column and compared against a game two columns along.
  const shelf = [...host.querySelectorAll('[class*="_mini_"]')]
    .find((el) => el.querySelector('button[aria-label="One more here"]')
      && el.querySelector('[class*="_item_"]'));
  assert.ok(shelf, 'no shelf with both a stepper and games on it');
  const plus = shelf.querySelector('button[aria-label="One more here"]');
  const firstGame = shelf.querySelector('[class*="_item_"]');
  assert.ok(firstGame.compareDocumentPosition(plus) & 4,
    'the stepper is still drawn above the games it counts');

  // What it would take next is inline and folded away. Closed it costs one
  // control; a board of thirty-five shelves cannot afford six named games and
  // their verbs apiece rendered whether or not anyone asked.
  const toggle = () => [...host.querySelectorAll('button[aria-expanded]')]
    .filter((b) => /\d+ next/.test(b.textContent))[0];
  assert.ok(toggle(), 'a shelf with games in reserve offered no way to see them');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'on deck starts open');
  const before = host.querySelectorAll('button').length;

  click(toggle());
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.ok(host.querySelectorAll('button').length > before,
    'opening the deck revealed nothing');
  // And it did not open the shelf: the toggle is its own target, in a cell
  // where everything else gives its click to the shelf.
  assert.ok(!host.querySelector('[role="dialog"]'), 'the deck toggle opened the shelf');

  click(toggle());
  assert.equal(host.querySelectorAll('button').length, before, 'the deck did not fold back');
  act(() => root.unmount());
});

test('the − stops at the games pinned to a shelf', () => {
  const { host, root } = mount();
  // `PlusMinus` has always taken a pinned floor and nothing ever passed it, so
  // the note promising it described a control that floored at zero.
  const pins = [...host.querySelectorAll('button[aria-label^="Pin "]')];
  const onShelf = pins[pins.length - 1];
  assert.ok(onShelf, 'nothing on the shelf to pin');
  click(onShelf);
  const fewer = host.querySelector('button[aria-label="One fewer here"]');
  assert.ok(fewer, 'the collection has no stepper');
  // One game is pinned to the one shelf there is, so the shelf can be trimmed
  // down to it and no further.
  const depth = host.querySelector('input[aria-label="Games on this shelf"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(depth, '1');
    depth.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.ok(host.querySelector('button[aria-label="One fewer here"]').disabled,
    'the shelf can be emptied out from under a pin');
  act(() => root.unmount());
});

test('an axis opens its own settings, in front of the shelves it describes', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));

  // The chip has two jobs now: the body opens the panel, the ✕ turns the axis
  // off. Clicking the body must not remove the split.
  const before = size(host);
  const body = [...host.querySelectorAll('button')]
    .find((b) => b.textContent.startsWith('player count'));
  click(body);
  assert.match(host.textContent, /Player groups/);
  assert.match(host.textContent, /How deep each one goes/);
  assert.match(host.textContent, /deep/, 'the panel did not report what it read');
  assert.equal(size(host), before, 'opening the panel changed the collection');

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
  assert.match(host.textContent, /are pinned, so each holds a place/);
  // Not a filter: the collection is still a whole collection, with yours in it.
  const after = size(host);
  assert.ok(after >= before,
    `building on ${before} games should not shrink the collection to ${after}`);
  assert.match(host.textContent, /Gloomhaven/, 'a game that was added is not held');

  // It is the pin verb, so it leaves pins: the button reads as pressed, and
  // every game it held carries its own release. As a mode it held them with
  // nothing on screen to say so and no way to let one go.
  assert.equal(only().getAttribute('aria-pressed'), 'true');
  const releases = () => [...host.querySelectorAll('button[aria-label^="Unpin"]')];
  assert.ok(releases().length > 0, 'built on games that show no pin to release');

  // And the rail says which of them the selection would not have taken. That
  // cannot be read back off the build — a split seeds every pick — so it is
  // recorded when the pin is pressed.
  assert.match(host.textContent, /Only here because you pinned it/,
    'nothing said which games are being carried');

  // One game released on its own, which is the whole point of it being a pin.
  const one = releases()[0].getAttribute('aria-label').replace('Unpin ', '');
  click(releases()[0]);
  assert.equal(only().getAttribute('aria-pressed'), 'false',
    'the set is no longer whole, so the button should not read as pressed');
  assert.ok(!releases().some((b) => b.getAttribute('aria-label') === `Unpin ${one}`),
    `${one} was released and is still pinned`);
  act(() => root.unmount());
});

test('build-on-mine survives a split, and still says what it is carrying', () => {
  const { host, root } = mount();
  click(byText('My games', host));
  const search = host.querySelector('input[aria-label="Search for a game"]');
  const add = (term) => {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, term);
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const hit = [...host.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith(term[0].toUpperCase()));
    if (hit) click(hit);
  };
  for (const term of ['gloomhaven', 'azul', 'wingspan', 'patchwork']) add(term);

  click(byText('Collection', host));
  click(byText('Build on mine', host));
  assert.match(host.textContent, /Only here because you pinned it/);

  // A split *deals* the collection out, so every pick is seeded and the build
  // can no longer tell a forced pin from anything else — measured, 24 of 213
  // picks read as seeded unsplit and 213 of 213 once dealt. The finding is held
  // in state, so it survives.
  click(byText('＋ player count', host));
  assert.match(host.textContent, /Only here because you pinned it/,
    'the split lost track of which games are being carried');
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

  const offered = () => (host.textContent.match(/＋ Add ([^\n]+?)(?:Goes on|Adds)/) ?? [])[1];
  type('');                                     // this used to throw
  assert.match(host.textContent, /Empty\./, 'no empty state');
  const first = offered();
  assert.ok(first, 'an empty collection should offer the best game there is');
  assert.ok(!host.textContent.includes('NaN'));

  // And back up again, one game at a time, naming each.
  click(byText(`＋ Add ${first}`, host));
  assert.equal(size(host), 1);
  assert.notEqual(offered(), first, 'the button did not move on');
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

  click(host.querySelector('[class*="picks"] button[aria-label^="Block"]'));
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
  const before = host.textContent.match(/(\d+) games/)[1];
  const shelf = openShelf(host);
  assert.ok(shelf, 'no shelf to open');
  const cellCount = () => shelf.querySelectorAll('button[aria-label="One more here"]').length;
  assert.equal(cellCount(), 1, 'a shelf you opened should offer exactly one stepper');
  click(shelf.querySelector('button[aria-label="One more here"]'));
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

test('the limits are a list, and the two that cannot work say why', () => {
  const { host, root } = mount();
  const open = [...host.querySelectorAll('summary')]
    .find((el) => el.textContent.includes('Fill until'));
  assert.ok(open, 'no fill rule in the bar');
  act(() => { open.parentElement.open = true; });

  // Three rows: how a shelf stops, and the two totals with no data behind them.
  const boxes = [...host.querySelectorAll('input[type="checkbox"]')];
  assert.equal(boxes.length, 3, 'the list should be the returns bar and two totals');
  assert.equal(boxes.filter((b) => b.disabled).length, 2);
  assert.match(host.textContent, /no price[^]*no box size/);
  // How many games there are is a result, not a limit.
  assert.ok(!/a number of games/.test(host.textContent),
    'the count is a readout in the bar, not a row here');
  act(() => root.unmount());
});

test('a depth you set outlives the filter you set it under', () => {
  const { host, root } = mount();
  const depth = () => host.querySelector('input[aria-label="Games on this shelf"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(depth(), '7');
    depth().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(size(host), 7);

  // Splitting and unsplitting used to clear every depth typed. It should not.
  click(byText('＋ player count', host));
  click([...host.querySelectorAll('button[aria-label^="Stop splitting"]')][0]);
  assert.equal(depth().value, '7', 'the depth was thrown away by a filter change');
  assert.equal(size(host), 7, 'the collection did not come back to what was set');
  act(() => root.unmount());
});

test('the same game twice is empty until something really is', () => {
  const { host, root } = mount();
  // The twelve-game collection holds no game twice: a duplicate is a reissue
  // BGG names, and there is none in it.
  assert.ok(!host.textContent.includes('The same game twice'),
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
  assert.match(host.textContent, /The same game twice/, 'a real duplicate went unreported');
  // The sparser record is the one named, not whichever came first, and it says
  // which of BGG's two relations put it there.
  assert.match(host.textContent,
    /Jaws of the Lion[^]*?Gloomhaven is the same game, more fully recorded/,
    'it named the wrong half of the pair');
  act(() => root.unmount());
});

test('the returns bar is a number you set, like every other limit', () => {
  const { host, root } = mount();
  const open = [...host.querySelectorAll('summary')]
    .find((el) => el.textContent.includes('Fill until'));
  act(() => { open.parentElement.open = true; });

  const field = host.querySelector('input[aria-label="a game stops paying, a shelf"]');
  assert.ok(field, 'the returns bar had no field to set it with');
  assert.equal(field.value, '45');

  const before = size(host);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(field, '90');
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  // A higher bar stops each shelf sooner, so the collection shrinks. Ninety
  // rather than seventy-five because the unsplit collection is twelve across the
  // whole 35-75% band on the live corpus — the number is robust to the
  // threshold, which is worth knowing and makes it a poor thing to test with.
  assert.ok(size(host) < before,
    `raising the bar to 90% should shrink ${before}, got ${size(host)}`);
  assert.match(host.textContent, /under 90% returns/);
  act(() => root.unmount());
});

test('games a shelf is a default, on every split, that a shelf can overrule', () => {
  const { host, root } = mount();
  const field = () => host.querySelector('input[aria-label="Games on this shelf"]');
  const type = (value) => act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(field(), value);
    field().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  // Unsplit, the one shelf's own number is the whole collection's size.
  assert.ok(field(), 'no games-a-shelf control unsplit');
  type('4');
  assert.equal(size(host), 4);

  // Splitting deals those four out rather than choosing again, so the control
  // that appears is the register default and the collection has not grown.
  click(byText('＋ player count', host));
  click(byText('＋ weight', host));
  assert.ok(field(), 'the control vanished when the grid came up');
  assert.equal(size(host), 4, 'splitting changed what the collection holds');

  // A shelf you open takes a number of its own, and keeps it when the default
  // moves underneath: the register is a guide at every level and a ceiling at
  // none.
  const shelf = openShelf(host);
  const count = () => Number(shelf.textContent.match(/(\d+) games/)[1]);
  click(shelf.querySelector('button[aria-label="One more here"]'));
  const mine = count();
  assert.equal(size(host), 5, 'a shelf could not be adjusted past the default');

  click(shelf.querySelector('button[aria-label="Close"]'));
  type('3');
  const filled = size(host);
  assert.ok(filled > 5, `the default should fill every other shelf, got ${filled}`);
  assert.equal(count(), mine, 'the default reached back over a shelf that was set');
  act(() => root.unmount());
});

test('the shelf default can be handed back to the curve', () => {
  const { host, root } = mount();
  const field = () => host.querySelector('input[aria-label="Games on this shelf"]');
  const tag = () => [...host.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === '↺');

  // Untouched it shows what the shelves are doing, and does not label it: a
  // number a reader typed and a number the shelf read are the same kind of
  // thing to look at, and calling one of them "auto" only raised the question.
  const read = size(host);
  assert.equal(field().value, String(read), 'the depth field and the collection disagree');
  assert.equal(tag(), undefined, 'nothing to clear before anything is set');

  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(field(), '4');
    field().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(size(host), 4);
  assert.ok(tag(), 'no way back once a number is set');

  click(tag());
  assert.equal(size(host), read,
    'clearing it did not hand the shelf back to the number it reads');
  act(() => root.unmount());
});

test('opening a shelf scopes the analyses to something small enough to move', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  click(byText('＋ weight', host));
  const fit = byText('Fit the shelves', host);
  if (fit) click(fit);

  // The rail describes the page, so it keeps describing the whole collection.
  const shapeIn = (where) => {
    const all = [...where.querySelectorAll('svg polygon')];
    return all[all.length - 1]?.getAttribute('points');
  };
  const whole = shapeIn(host);
  assert.ok(whole, 'no radar');
  assert.match(host.textContent, /What it reaches/);

  // The shelf you open describes that shelf. Both at once, and they disagree —
  // which is the point: across 272 games every game's unique share reads
  // 0.0000, and on a shelf of nine it spreads.
  const shelf = openShelf(host, (els) => els.find((el) => {
    const mini = el.closest('[class*="_mini_"]');
    return mini && mini.querySelectorAll('[class*="compact"]').length >= 4;
  }));
  assert.ok(shelf, 'no shelf with enough games to open');
  assert.match(shelf.textContent, /What this shelf reaches/, 'the shelf drew no radar of its own');
  assert.notEqual(shapeIn(shelf), whole, 'the shelf drew the whole collection shape');
  assert.match(host.textContent, /What it reaches/, 'the rail followed the shelf');
  assert.equal(shapeIn(host), whole, 'the rail stopped describing the collection');

  // Closing it leaves nothing behind.
  click(shelf.querySelector('button[aria-label="Close"]'));
  assert.equal(document.querySelector('[role="dialog"]'), null, 'the shelf did not close');
  act(() => root.unmount());
});

test('held twice never proposes the game the selection already turned down', () => {
  const { host, root } = mount();
  // Whatever it says, it must not offer a replacement: measured, the shelf's
  // top alternate makes that shelf worse (0.372 -> 0.141) and the collection
  // very slightly worse too.
  assert.ok(!/comes in/.test(host.textContent),
    'the panel is still offering the runner-up as an improvement');
  act(() => root.unmount());
});

test('what is over-represented appears only once you own enough to say', () => {
  const { host, root } = mount();
  assert.ok(!/More of these than you need/.test(host.textContent),
    'it spoke about a collection nobody uploaded');

  const add = (term) => {
    const search = host.querySelector('input[aria-label="Search for a game"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, term);
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const hit = [...host.querySelectorAll('button')]
      .find((b) => /Add|Remove/.test(b.textContent) === false
        && b.className.includes('result'));
    const row = hit ?? [...host.querySelectorAll('button[class*="result"]')][0];
    if (row) click(row);
  };
  click(byText('My games', host));
  for (const term of ['wingspan', 'gloomhaven', 'codenames', 'brass', 'azul', 'root']) add(term);
  click(byText('Collection', host));

  // Six games is enough to have a shape; the analysis either speaks or is
  // silent, and must never render a heading over nothing.
  const heading = /More of these than you need/.test(host.textContent);
  if (heading) {
    assert.match(host.textContent, /\d+ of \d+/, 'a heading with no counts under it');
    assert.match(host.textContent, /Of your \d+ games/);
  }
  act(() => root.unmount());
});

test('add the next game actually adds it, above the curve as well as below', () => {
  const { host, root } = mount();
  const offered = () => (host.textContent.match(/＋ Add ([^\n]+?)(?:Goes on|Adds)/) ?? [])[1];

  // Pressing it at the depth the curve chose used to do nothing: the number was
  // a ceiling on the reading, so asking for one more came back as the same.
  const before = size(host);
  const first = offered();
  assert.ok(first, 'nothing offered');
  click(byText(`＋ Add ${first}`, host));
  assert.equal(size(host), before + 1, 'the button did not add a game');
  assert.notEqual(offered(), first, 'it is still offering the game it just added');
  // The game it named is the game that arrived. It used to raise a depth by one
  // and let the next allocation choose who filled the slot, while the label came
  // from a probe that sees no blocks and no pins and is memoised without them —
  // so blocking the offered game left it offered and added somebody else.
  const shelf = host.querySelector('[class*="picks"]');
  assert.ok([...shelf.querySelectorAll('[class*="_item_"]')]
    .some((el) => el.textContent.includes(first)),
  `it offered ${first} and put something else on the shelf`);

  click(byText(`＋ Add ${offered()}`, host));
  assert.equal(size(host), before + 2, 'the second press did not add either');

  // Nothing is overruled any more: the register is a guide that a shelf, a
  // column or a row can each speak over, so the fill list has no exception to
  // report and stops reporting one.
  const open = [...host.querySelectorAll('summary')]
    .find((el) => el.textContent.includes('Fill until'));
  act(() => { open.parentElement.open = true; });
  assert.ok(!/overruled/.test(host.textContent), 'still claiming something is overruled');
  act(() => root.unmount());
});

test('unpinning takes back the game the pin added', () => {
  const { host, root } = mount();
  // Split first, so the collection is *dealt*. Undealt, every shelf simply fills
  // to its depth and a pin picks which games fill it — it swaps rather than
  // adds, and there is no addition for an unpin to take back.
  click(byText('＋ player count', host));
  // The rail offers games that are *not* in the collection — that is what a gap
  // is — so its pin is the one that adds rather than holds.
  const rail = host.querySelector('aside');
  assert.ok(rail, 'no rail to read findings from');
  const pin = [...rail.querySelectorAll('button[aria-label^="Pin"]')][0];
  assert.ok(pin, 'the rail offered nothing to pin');
  const name = pin.getAttribute('aria-label').replace(/^Pin\s+/, '');

  const before = size(host);
  click(pin);
  assert.equal(size(host), before + 1, `pinning ${name} did not add it`);

  // `held` is a flat list of ids and could not say *why* a game was in it, so
  // the unpin had nothing to undo: the game stayed for good, and being seeded it
  // outranked the selection on every rebuild afterwards.
  const unpin = [...host.querySelectorAll('button[aria-label^="Unpin"]')]
    .find((b) => b.getAttribute('aria-label').includes(name));
  assert.ok(unpin, `nothing to unpin ${name} with`);
  click(unpin);
  assert.equal(size(host), before,
    `unpinning ${name} left it in the collection`);
  act(() => root.unmount());
});

test('a finding names the shelf it was measured on', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  const rail = host.querySelector('aside');
  const gap = [...rail.querySelectorAll('h2')]
    .find((h) => h.textContent.includes('what is missing'));
  assert.ok(gap, 'the rail stopped reporting gaps');
  // A finding rolled up across a grid is measured on one shelf, and the shelf
  // it was measured on was attached to the finding and then never rendered —
  // so the reader got a number with no way to know what it was a number about.
  assert.match(rail.textContent, /, on (solo|\d+ players)\b/,
    'the gap finding names no shelf');
  act(() => root.unmount());
});

test('an analysis registered twice is still drawn once', async () => {
  // The rail grew a second radar every time an analysis module was evaluated
  // again — Vite re-running `reach.jsx` on save is the everyday case — because
  // `register` pushed onto a module-global list that outlives every component.
  // The rail then rendered the same analysis twice under one React key.
  const { host, root } = mount();
  const radars = () => host.querySelectorAll('svg polygon').length;
  const before = radars();
  assert.ok(before > 0, 'the radar did not draw at all');

  const { all } = await vite.ssrLoadModule('/src/ui/analysis/registry.js');
  const listed = all().length;
  const mod = vite.moduleGraph.getModuleById(join(WEB, 'src/ui/analysis/reach.jsx'));
  assert.ok(mod, 'could not reach the analysis module to re-evaluate it');
  vite.moduleGraph.invalidateModule(mod);
  await vite.ssrLoadModule('/src/ui/analysis/reach.jsx');

  assert.equal(all().length, listed,
    `re-evaluating one analysis took the registry ${listed} -> ${all().length}`);
  assert.deepEqual(all().map((a) => a.id), [...new Set(all().map((a) => a.id))],
    'the registry holds the same analysis twice');
  act(() => root.unmount());
});

test('blocking replaces the game, whether or not the collection was dealt', () => {
  const { host, root } = mount();
  // Only games actually on a shelf. The rail offers Block on games that are not
  // in the collection at all — blocking one of those removes nothing, which is
  // not the question here.
  const onShelf = () => [...host.querySelectorAll('button[aria-label^="Block"]')]
    .filter((b) => !b.closest('aside'));
  const shelved = () => host.querySelector('[class*="picks"]')
    .querySelectorAll(':scope > [class*="_item_"]').length;

  // Undealt, one shelf: it fills to its depth, so something always took the slot.
  const before = shelved();
  assert.ok(onShelf().length, 'no game on a shelf to block');
  click(onShelf()[0]);
  assert.equal(shelved(), before, 'blocking shrank the undealt collection');

  // Dealt. This is where it used to differ: the game came out of `held` as well
  // as being banned, so its shelf asked for one fewer and simply got smaller.
  // Measured on the shipped corpus, a 50-game split went to 49 while an undealt
  // one stayed at 50 and a register set stayed at 42 — and nothing on screen
  // said which you would get.
  click(byText('＋ player count', host));
  const dealt = size(host);
  assert.ok(onShelf().length, 'no game on a shelf to block once split');
  click(onShelf()[0]);
  assert.equal(size(host), dealt,
    `blocking took the dealt collection ${dealt} -> ${size(host)} instead of replacing`);
  act(() => root.unmount());
});

test('a game in a grid cell is not its own target; the shelf is', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  click(byText('＋ weight', host));

  // A mini cell used to hold five competing targets — the shelf, and five names
  // that each swallowed the click and opened a different overlay.
  const cell = [...host.querySelectorAll('[class*="_cell_"]')]
    .find((el) => el.querySelector('[class*="_item_"]'));
  assert.ok(cell, 'no filled cell on the board');
  const name = cell.querySelector('[class*="_main_"]');
  assert.ok(name, 'a cell with no game in it');
  assert.equal(name.getAttribute('role'), null,
    'a game on the board is still its own click target');

  // Clicking it opens the shelf, not the game.
  click(name);
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'clicking a game in a cell opened nothing at all');
  assert.ok(!/^#\d/.test(dialog.textContent.trim()),
    'clicking a game in a cell opened the game rather than the shelf');

  // On the shelf you have opened, every game is a target again and carries a
  // way out to BoardGameGeek.
  const rows = [...dialog.querySelectorAll('[class*="_main_"]')]
    .filter((el) => el.getAttribute('role') === 'button');
  assert.ok(rows.length, 'no game is clickable on the shelf you opened');
  // BoardGameGeek is reached from the board game view and nowhere else — a link
  // on every row of every shelf is forty ways out of a page nobody asked to
  // leave.
  assert.equal(
    dialog.querySelectorAll('a[href^="https://boardgamegeek.com/boardgame/"]').length, 0,
    'a shelf row is still carrying a BoardGameGeek link');
  act(() => root.unmount());
});

test('a shelf on the board takes one more without being opened', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  const more = [...host.querySelectorAll('button[aria-label="One more here"]')];
  assert.ok(more.length, 'no stepper on the board');
  // Deliberately back after being removed — see the note in `Cell.jsx`. It is
  // the only thing in a mini cell that takes a click of its own.
  const before = size(host);
  click(more[0]);
  assert.equal(size(host), before + 1,
    `the board stepper took the collection ${before} -> ${size(host)}`);
  const fewer = [...host.querySelectorAll('button[aria-label="One fewer here"]')];
  click(fewer[0]);
  assert.equal(size(host), before, 'the board stepper does not go back down');
  act(() => root.unmount());
});


test('the board game view is one click further in, and there is a way back', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));

  // Cell → shelf. A game in the cell no longer takes this click.
  const cell = [...host.querySelectorAll('[class*="_column_"]')]
    .find((el) => el.querySelector('[class*="_item_"]'));
  click(cell.querySelector('[class*="_main_"]'));
  const shelf = document.querySelector('[role="dialog"]');
  assert.ok(shelf, 'clicking a cell opened nothing');

  // Shelf → game. This is the board game view, and it is what the games on an
  // opened shelf are clickable *for*.
  const row = [...shelf.querySelectorAll('[class*="_main_"]')]
    .find((el) => el.getAttribute('role') === 'button');
  assert.ok(row, 'no game to open on the shelf');
  const name = row.querySelector('[class*="_name_"]').textContent.trim();
  click(row);
  const game = document.querySelector('[role="dialog"]');
  assert.match(game.textContent, /BoardGameGeek/, 'the game view has no way out to BGG');
  assert.match(game.textContent, /best at|length|weight/, 'the game view is missing its facts');

  // …and back to the shelf it was opened from, never two overlays stacked.
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1,
    'the game view stacked a second overlay on the shelf');
  const back = [...game.querySelectorAll('button')]
    .find((b) => /back/i.test(b.getAttribute('aria-label') || b.textContent));
  assert.ok(back, `no way back from ${name}`);
  click(back);
  assert.ok(!/BoardGameGeek/.test(document.querySelector('[role="dialog"]').textContent),
    'going back did not return to the shelf');
  act(() => root.unmount());
});

test('an opened shelf is drawn against what its own cell could reach', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  click(byText('＋ weight', host));
  const cell = [...host.querySelectorAll('[class*="_cell_"]')]
    .find((el) => el.querySelector('[class*="_item_"]'));
  click(cell.querySelector('[class*="_main_"]'));
  const shelf = document.querySelector('[role="dialog"]');
  assert.ok(shelf, 'no shelf opened');

  // Drawn the way the collection is — one shape, no overlay — over the only
  // population it could ever hold. Against the whole corpus a shelf of eight
  // answered 0.069 and drew as a speck inside a ring standing for ground it was
  // never going to cover.
  assert.match(shelf.textContent, /out of what the \d+ games that fit here could reach/,
    'the shelf is not measured against its own eligible population');
  assert.ok(!/The collection/.test(
    shelf.querySelector('[class*="_key_"]')?.textContent ?? ''),
  'the corpus is still the reference on an opened shelf');
  // One series, like the collection: the outline polygon is the second one.
  const outline = shelf.querySelectorAll('polygon[class*="outline"]');
  assert.equal(outline.length, 0, 'the shelf still draws a second series over itself');
  act(() => root.unmount());
});

test('a game on the board game view opens as a board game view of its own', () => {
  const { host, root } = mount();
  click(byText('＋ player count', host));
  const cell = [...host.querySelectorAll('[class*="_column_"]')]
    .find((el) => el.querySelector('[class*="_item_"]'));
  click(cell.querySelector('[class*="_main_"]'));
  const row = [...document.querySelector('[role="dialog"]').querySelectorAll('[class*="_main_"]')]
    .find((el) => el.getAttribute('role') === 'button');
  click(row);

  const first = document.querySelector('[role="dialog"]');
  const name = first.querySelector('h2').textContent.trim();
  // BoardGameGeek is reached from here and only here.
  assert.equal(first.querySelectorAll(
    'a[href^="https://boardgamegeek.com/boardgame/"]').length, 1,
  'the board game view should carry exactly one way out to BoardGameGeek');

  // "Games like it" names other games, and each is a way into its own view
  // rather than a label you cannot follow.
  const like = [...first.querySelectorAll('button[class*="_pick_"]')];
  assert.ok(like.length, 'nothing under "Games like it" can be opened');
  const wanted = like[0].textContent.trim().split('  #')[0];
  click(like[0]);

  const second = document.querySelector('[role="dialog"]');
  assert.equal(second.querySelector('h2').textContent.trim(), wanted,
    'opening a game like it opened something else');
  assert.notEqual(second.querySelector('h2').textContent.trim(), name,
    'it opened the game that was already open');
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1,
    'the second game stacked a third overlay');

  // Back walks the chain that was clicked rather than dropping out of it.
  const back = [...second.querySelectorAll('button')]
    .find((b) => /back/i.test(b.getAttribute('aria-label') || b.textContent));
  assert.ok(back, 'no way back from a game opened from a game');
  click(back);
  assert.equal(document.querySelector('[role="dialog"]').querySelector('h2').textContent.trim(),
    name, 'back did not return to the game it was opened from');
  act(() => root.unmount());
});
