/**
 * Filling the grid: rounds of bidding, not one long greedy pass.
 *
 * A game is placed at most once anywhere, so something has to decide which cell
 * gets a contested one. Every cell bids for its best remaining candidate, the
 * contested game goes to whichever gains most, losers re-bid, and nothing
 * commits until the round ends. So **every cell takes its first pick before any
 * cell takes its second**, and a thin cell cannot be picked clean by a
 * well-stocked neighbour helping itself repeatedly.
 */

const roomFor = (capacity, key) =>
  typeof capacity === 'number' ? capacity
    : capacity instanceof Map ? (capacity.get(key) ?? 0)
      : (capacity[key] ?? 0);

/** One round of deferred acceptance. Returns cell -> {pool index, score}. */
function bidRound(scorer, cells, capacity, taken, gainFloor) {
  const held = new Map();                       // game row -> {cell, score, i}
  const blocked = new Map(cells.map((c) => [c.key, new Set()]));
  const pending = cells.filter((c) => c.chosen.length < roomFor(capacity, c.key));

  while (pending.length) {
    const cell = pending.shift();
    const scores = scorer.scoreAll(cell);
    const skip = blocked.get(cell.key);

    let best = -1, bestScore = 0, bestDegree = -1;
    for (let i = 0; i < cell.games.length; i++) {
      const g = cell.games[i];
      if (taken.has(g) || skip.has(g)) continue;
      const v = scores[i];
      if (v < gainFloor) continue;
      // Membership breaks ties, so a game is never claimed by a cell it barely
      // reaches while one centred on it wants the same game.
      if (best < 0 || v > bestScore || (v === bestScore && cell.degree[i] > bestDegree)) {
        best = i; bestScore = v; bestDegree = cell.degree[i];
      }
    }
    if (best < 0) continue;                     // nothing left worth taking

    const game = cell.games[best];
    const incumbent = held.get(game);
    if (!incumbent) {
      held.set(game, { cell, score: bestScore, i: best });
    } else if (bestScore > incumbent.score) {
      held.set(game, { cell, score: bestScore, i: best });
      blocked.get(incumbent.cell.key).add(game);
      pending.push(incumbent.cell);             // displaced cell bids again
    } else {
      skip.add(game);
      pending.push(cell);
    }
  }
  return held;
}

/**
 * Move a game if some cell with room would value it more.
 *
 * A round commits its awards together, so a cell that valued a game more may
 * not have bid before it was claimed. Seeded games are pinned: the caller placed
 * them, so they are not the allocator's to move.
 */
function repair(scorer, cells, capacity, gains, pinned) {
  const replay = (cell, keep) => {
    scorer.resetCell(cell);
    for (const i of keep) scorer.take(cell, i);
  };

  for (let pass = 0; pass < cells.length; pass++) {
    let moved = false;
    for (const cell of cells) {
      for (const i of [...cell.chosen]) {
        const game = cell.games[i];
        if (pinned.has(game)) continue;
        const here = scorer.scoreAll(cell)[i];
        for (const other of cells) {
          if (other === cell || other.chosen.length >= roomFor(capacity, other.key)) continue;
          const at = other.games.indexOf(game);
          if (at < 0) continue;                 // does not reach that cell
          const there = scorer.scoreAll(other)[at];
          if (there > here + 1e-9) {
            const keep = cell.chosen.filter((x) => x !== i);
            gains.delete(`${cell.key}|${game}`);
            replay(cell, keep);
            scorer.take(other, at);
            gains.set(`${other.key}|${game}`, there);
            moved = true;
            break;
          }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) return;
  }
}

/** Placed games the shelf already holds as a redoing, and how strongly. */
function rerecordings(ix, scorer, cells, pinned) {
  const placed = [];
  for (const cell of cells) {
    for (const i of cell.chosen) placed.push({ cell, i, game: cell.games[i] });
  }
  const flagged = new Map();
  const flag = (game, strength) => {
    if (pinned.has(game)) return;               // the reader owns it
    flagged.set(game, Math.max(flagged.get(game) ?? 0, strength));
  };

  for (let x = 0; x < placed.length; x++) {
    for (let y = x + 1; y < placed.length; y++) {
      const a = placed[x].game, b = placed[y].game;
      const aKin = ix.kin.get(a);
      if ((aKin && aKin.includes(b)) || (ix.kin.get(b) || []).includes(a)) {
        // A redoing that moved to another player count or weight is a new game;
        // one that moved nowhere is the same game twice.
        flag(ix.rank[b] > ix.rank[a] ? b : a, scorer._overlap(a, b));
      }
      if ((ix.thin.get(a) || new Set()).has(b)) flag(a, 1.0);
      if ((ix.thin.get(b) || new Set()).has(a)) flag(b, 1.0);
    }
  }
  return flagged;
}

/**
 * Swap out re-recordings the collection gains nothing from holding twice.
 *
 * Only ever a swap: a cell with nothing to put in the slot keeps what it has.
 * The bar slides with how redundant the game is — one the shelf fully
 * duplicates is worth replacing at `replacementKeep` of its slot, one that
 * barely overlaps has to be replaced by something outright better.
 */
function improveCollection(ix, scorer, cells, gains, taken, pinned) {
  const keep = ix.policy.replacementKeep;
  const swaps = [];

  for (const [game, strength] of rerecordings(ix, scorer, cells, pinned)) {
    if (strength <= 0) continue;
    const cell = cells.find((c) => c.chosen.some((i) => c.games[i] === game));
    if (!cell) continue;
    const slot = cell.chosen.find((i) => cell.games[i] === game);
    const here = scorer.scoreAll(cell)[slot];

    const rest = cell.chosen.filter((i) => i !== slot);
    scorer.resetCell(cell);
    for (const i of rest) scorer.take(cell, i);

    const scores = scorer.scoreAll(cell);
    let best = -1, bestScore = 0;
    for (let i = 0; i < cell.games.length; i++) {
      const g = cell.games[i];
      if (taken.has(g)) continue;
      // The replacement must be less redundant than what it replaces, or the
      // swap achieves nothing.
      const redone = scorer._redone(g);
      if (redone !== null && redone >= strength) continue;
      if (scores[i] > bestScore) { best = i; bestScore = scores[i]; }
    }

    const bar = keep + (1 - keep) * (1 - strength);
    if (best >= 0 && bestScore >= bar * here) {
      taken.delete(game);
      taken.add(cell.games[best]);
      gains.delete(`${cell.key}|${game}`);
      gains.set(`${cell.key}|${cell.games[best]}`, bestScore);
      scorer.take(cell, best);
      swaps.push({ cell: cell.key, out: game, in: cell.games[best] });
    } else {
      scorer.take(cell, slot);
    }
  }
  return swaps;
}

export function allocate(ix, scorer, cells, {
  capacity, seeded = new Map(), rejected = new Set(),
  alternatesLimit = 0, gainFloor = null, improve = true,
} = {}) {
  const floor = gainFloor ?? ix.policy.gainFloor;
  const taken = new Set(rejected);
  const gains = new Map();
  const pinned = new Set();

  for (const [key, games] of seeded) {
    const cell = cells.find((c) => c.key === key);
    if (!cell) continue;
    for (const game of games) {
      if (taken.has(game)) continue;            // owned *and* banned: banned wins
      const i = cell.games.indexOf(game);
      if (i < 0) continue;
      scorer.take(cell, i);
      taken.add(game);
      pinned.add(game);
    }
  }

  const slots = cells.reduce((sum, c) => sum + roomFor(capacity, c.key), 0);
  for (let round = 0; round < slots + cells.length; round++) {
    let awards = bidRound(scorer, cells, capacity, taken, floor);
    if (!awards.size) {
      repair(scorer, cells, capacity, gains, pinned);
      awards = bidRound(scorer, cells, capacity, taken, floor);
      if (!awards.size) break;
    }
    // A round commits together, best gain first.
    for (const [game, { cell, score, i }] of [...awards].sort((a, b) => b[1].score - a[1].score)) {
      if (taken.has(game)) continue;
      taken.add(game);
      gains.set(`${cell.key}|${game}`, score);
      scorer.take(cell, i);
    }
  }

  if (improve) improveCollection(ix, scorer, cells, gains, taken, pinned);

  return cells.map((cell) => {
    const picks = cell.chosen.map((i) => cell.games[i]);
    const chosen = new Set(picks);
    const alternates = [...cell.games]
      .filter((g) => !chosen.has(g) && !taken.has(g))
      .sort((a, b) => ix.rank[a] - ix.rank[b])
      .slice(0, alternatesLimit);
    return {
      key: cell.key, column: cell.column, row: cell.row,
      candidateCount: cell.games.length,
      picks,
      gains: picks.map((g) => gains.get(`${cell.key}|${g}`) ?? null),
      alternates,
    };
  });
}
