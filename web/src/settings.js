/**
 * What the reader has decided, kept in the URL and in localStorage.
 *
 * Everything here is *theirs* — the axes, how deep the shelves go, which kinds
 * they want reached for, what they own, what they never want offered. None of
 * it comes from the model, and none of it is a model hyperparameter: those live
 * in the contract's `policy` and are applied without ever being shown.
 *
 * The URL carries it so a configured grid can be sent to someone. Ids dominate
 * the length, so they are delta-encoded in base 36 — a hundred-game collection
 * costs about 400 characters that way against 700 spelled out.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'boardgame-grid/settings';

export const DEFAULT_COLUMNS = [
  { label: '1', lo: 1, hi: 1 }, { label: '2', lo: 2, hi: 2 },
  { label: '3', lo: 3, hi: 3 }, { label: '4', lo: 4, hi: 4 },
  { label: '5', lo: 5, hi: 5 }, { label: '6-8', lo: 6, hi: 8 },
  { label: '8+', lo: 9, hi: null },
];

export const DEFAULTS = {
  columns: DEFAULT_COLUMNS,
  rowCount: 5,
  picksPerCell: 5,
  picksPerColumn: {},          // label -> cap, for columns worth less depth
  genreWeights: {},            // group index -> 0..2, absent means 1
  gainFloor: null,             // null = the contract's own
  owned: [], keepers: [], banned: [],
};

/** Sorted ids as base-36 deltas: "1r.4.9" rather than "63.67.76". */
export function packIds(ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  let last = 0;
  return sorted.map((id) => { const d = id - last; last = id; return d.toString(36); }).join('.');
}

export function unpackIds(text) {
  if (!text) return [];
  let last = 0;
  return text.split('.').map((part) => (last += parseInt(part, 36)));
}

/** Only what differs from the defaults, so a plain grid shares a bare URL. */
export function encode(settings) {
  const out = {};
  if (settings.rowCount !== DEFAULTS.rowCount) out.r = settings.rowCount;
  if (settings.picksPerCell !== DEFAULTS.picksPerCell) out.p = settings.picksPerCell;
  if (settings.gainFloor !== null) out.f = settings.gainFloor;
  if (Object.keys(settings.picksPerColumn).length) out.pc = settings.picksPerColumn;
  if (Object.keys(settings.genreWeights).length) out.gw = settings.genreWeights;
  if (JSON.stringify(settings.columns) !== JSON.stringify(DEFAULT_COLUMNS)) {
    out.c = settings.columns.map((c) => [c.label, c.lo, c.hi ?? 0]);
  }
  for (const [key, list] of [['o', 'owned'], ['k', 'keepers'], ['b', 'banned']]) {
    if (settings[list].length) out[key] = packIds(settings[list]);
  }
  return Object.keys(out).length ? encodeURIComponent(JSON.stringify(out)) : '';
}

export function decode(text) {
  if (!text) return { ...DEFAULTS };
  let raw;
  try { raw = JSON.parse(decodeURIComponent(text)); } catch { return { ...DEFAULTS }; }
  return {
    ...DEFAULTS,
    rowCount: raw.r ?? DEFAULTS.rowCount,
    picksPerCell: raw.p ?? DEFAULTS.picksPerCell,
    gainFloor: raw.f ?? null,
    picksPerColumn: raw.pc ?? {},
    genreWeights: raw.gw ?? {},
    columns: raw.c
      ? raw.c.map(([label, lo, hi]) => ({ label, lo, hi: hi || null }))
      : DEFAULT_COLUMNS,
    owned: unpackIds(raw.o), keepers: unpackIds(raw.k), banned: unpackIds(raw.b),
  };
}

function load() {
  const fromUrl = window.location.hash.slice(1);
  if (fromUrl) return decode(fromUrl);
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch { /* private browsing, corrupt entry — the defaults are fine */ }
  return { ...DEFAULTS };
}

export function useSettings() {
  const [settings, setSettings] = useState(load);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    const encoded = encode(settings);
    const url = encoded ? `#${encoded}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [settings]);

  const update = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  const reset = useCallback(() => setSettings({ ...DEFAULTS }), []);
  return [settings, update, reset];
}

/** Toggle an id in one of the three lists, keeping the others consistent. */
export function toggleIn(settings, list, id) {
  const has = settings[list].includes(id);
  const next = { [list]: has ? settings[list].filter((x) => x !== id) : [...settings[list], id] };
  // A game cannot be both banned and wanted: banning something drops it from
  // keepers, and keeping something un-bans it.
  if (!has && list === 'banned') {
    next.keepers = settings.keepers.filter((x) => x !== id);
  }
  if (!has && list === 'keepers') {
    next.banned = settings.banned.filter((x) => x !== id);
  }
  return next;
}
