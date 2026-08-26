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
  // Twelve, read off the curve rather than set by anyone. The names in it
  // belong to whatever corpus is shipped, so the test does not spell them.
  assert.equal(size(host), 12);
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

test('doubled up is empty until something really is', () => {
  const { host, root } = mount();
  // The twelve-game collection has no duplicate in it by construction: its
  // closest pair sits at 0.44 similarity, where a real duplicate sits at 0.95.
  assert.ok(!host.textContent.includes('Doubled up'),
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
  assert.match(host.textContent, /Doubled up/, 'a real duplicate went unreported');
  // The more contained side is the one named, not whichever came first.
  assert.match(host.textContent,
    /Jaws of the Lion[^]*?Gloomhaven already covers \d+%/,
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
  assert.equal(field().value, '12');
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
  assert.equal(size(host), 12, 'clearing it did not hand the shelf back to its curve');
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
