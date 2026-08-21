/**
 * Load the contract once, then recompute the grid whenever settings change.
 *
 * The contract is ~2 MB and indexing it into typed arrays costs ~25ms, so both
 * happen once and the result is held. A recompute is ~120ms on the live
 * capture, which is fast enough to run on release rather than behind a button —
 * except for the ban list, which the reader builds up before asking for a
 * rerun.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, indexContract } from './engine/index.js';

export function useGrid(settings) {
  const [ix, setIx] = useState(null);
  const [error, setError] = useState(null);
  const timing = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}grid.contract.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} fetching the contract`);
        return r.json();
      })
      .then((contract) => {
        if (cancelled) return;
        if (!contract.contract?.startsWith('boardgame-grid/1')) {
          throw new Error(`unknown contract version ${contract.contract}`);
        }
        setIx(indexContract(contract));
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, []);

  const result = useMemo(() => {
    if (!ix) return null;
    const started = performance.now();
    const built = buildGrid(ix, {
      columns: settings.columns,
      rowCount: settings.rowCount,
      capacity: capacityFor(settings),
      owned: settings.owned,
      keepers: settings.keepers,
      banned: settings.banned,
      genreWeights: Object.keys(settings.genreWeights).length ? settings.genreWeights : null,
      gainFloor: settings.gainFloor,
      alternatesLimit: 6,
    });
    timing.current = Math.round(performance.now() - started);
    return built;
  }, [ix, settings]);

  return { ix, result, error, ms: timing.current };
}

/**
 * Slots per cell, as the map the allocator wants.
 *
 * Columns are fixed ranges over a lopsided distribution — `8+` reaches a
 * fraction of the games `4` does — so the same five slots mean very different
 * things across the grid. A column cap says so explicitly; `gainFloor` says it
 * by declining to shelve games that barely reach their cell.
 */
function capacityFor(settings) {
  const caps = settings.picksPerColumn;
  if (!Object.keys(caps).length) return settings.picksPerCell;
  const out = {};
  for (const column of settings.columns) {
    for (let row = 0; row < settings.rowCount; row++) {
      out[`${column.label}|${row}`] = Math.min(
        settings.picksPerCell, caps[column.label] ?? Infinity);
    }
  }
  return out;
}
