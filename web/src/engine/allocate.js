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

export const roomFor = (capacity, key) =>
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
    // Scored once per cell per pass. A cell's scores depend only on what it
    // holds, and nothing here changes that until a move — at which point the
    // pass ends anyway. Rescoring inside the loops instead made a shelf of
    // twenty rescore itself twenty times over, and again for every cell it
    // compared against: at a 15% returns bar this pass ran `scoreAll` 15,161
    // times against 452 at the default, and a rebuild took 25 seconds.
    const scored = new Set();
    const scoresOf = (c) => {
      if (!scored.has(c.key)) { scorer.scoreAll(c); scored.add(c.key); }
      return c.scores;
    };
    for (const cell of cells) {
      for (const i of [...cell.chosen]) {
        const game = cell.games[i];
        if (pinned.has(game)) continue;
        const here = scoresOf(cell)[i];
        for (const other of cells) {
          if (other === cell || other.chosen.length >= roomFor(capacity, other.key)) continue;
          const at = other.games.indexOf(game);
          if (at < 0) continue;                 // does not reach that cell
          const there = scoresOf(other)[at];
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
function improveCollection(ix, scorer, cells, gains, taken, pinned,
                           { budget = null, spent = 0, costOf = UNIT_COST } = {}) {
  const keep = ix.policy.replacementKeep;
  let extra = 0;

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
    // A swap must also fit: under a money budget the replacement can cost more
    // than what it replaces, and a swap is never worth going over for.
    const room = best < 0 || budget == null
      || spent + extra - costOf(game) + costOf(cell.games[best]) <= budget;
    if (best >= 0 && room && bestScore >= bar * here) {
      taken.delete(game);
      taken.add(cell.games[best]);
      gains.delete(`${cell.key}|${game}`);
      gains.set(`${cell.key}|${cell.games[best]}`, bestScore);
      scorer.take(cell, best);
      extra += costOf(cell.games[best]) - costOf(game);
    } else {
      scorer.take(cell, slot);
    }
  }
  return extra;
}

/**
 * What the collection may spend in total, against the per-shelf ceilings.
 *
 * `capacity` says how deep one shelf may go; `budget` says how much the whole
 * collection may cost, in whatever unit `costOf` returns. Both are ceilings and
 * both apply — a budget trims the collection to what fits rather than removing
 * per-shelf depth and piling everything into whichever corner pays best.
 *
 * With `costOf` returning 1, a budget of N is a collection of N games, which is
 * the only unit the data supports today: BGG publishes no price and no box
 * size. The abstraction is here so that the day one of those arrives is a
 * different `costOf`, not a different allocator.
 *
 * Greedy, not optimal. Each round commits its awards in descending gain per
 * unit cost and stops when the next one will not fit; a knapsack solved
 * properly would do marginally better and would not survive being re-run on
 * every keystroke.
 */
export const UNIT_COST = () => 1;

export function allocate(ix, scorer, cells, {
  capacity, seeded = new Map(), rejected = new Set(),
  alternatesLimit = 0, gainFloor = null, improve = true,
  budget = null, costOf = UNIT_COST,
} = {}) {
  const floor = gainFloor ?? ix.policy.gainFloor;
  const taken = new Set(rejected);
  const gains = new Map();
  const pinned = new Set();
  let spent = 0;
  const affordable = (game) => budget == null || spent + costOf(game) <= budget;

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
      // A pin is a game you are keeping, so it is spent whether or not it fits.
      spent += costOf(game);
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
    // A round commits together, best value first — gain per unit of whatever is
    // being spent, which is gain itself while everything costs the same.
    const value = ([game, { score }]) => score / (costOf(game) || 1);
    for (const award of [...awards].sort((a, b) => value(b) - value(a))) {
      const [game, { cell, score, i }] = award;
      if (taken.has(game)) continue;
      if (!affordable(game)) continue;
      taken.add(game);
      spent += costOf(game);
      gains.set(`${cell.key}|${game}`, score);
      scorer.take(cell, i);
    }
    if (budget != null && spent >= budget) break;
  }

  if (improve) {
    spent += improveCollection(ix, scorer, cells, gains, taken, pinned,
                               { budget, spent, costOf });
  }

  // A general swap pass — for every pick, could this shelf take something it
  // would rather have — was written, measured and taken back out. It works:
  // 25 such swaps exist on the live grid without it, the best +0.273 (Targi ->
  // 7 Wonders Duel), and two passes reach exactly zero at every split. It costs
  // a two-split rebuild 412ms -> 4,732ms, because it needs `scoreAll` once per
  // *slot* rather than per cell: 272 slots, up to four passes, a pool of
  // thousands. Eleven times the rest of the build for a 9% tidier allocation
  // that moves the median rank by two places.
  //
  // The invariant it was for — nothing to suggest on a collection nobody
  // uploaded — is bought instead by scoping the trim analysis to games the
  // reader owns. With none owned there is nothing to say, which is the same
  // promise for none of the price.

  // Everything shelved anywhere, so the queue below can leave out the games the
  // improve pass would immediately throw back. Offering one is a loop: raise
  // the shelf's depth, it gets placed, it gets swapped straight out, and the
  // same name comes up again — which is exactly what "Add Gloomhaven: Jaws of
  // the Lion" did four times running while Gloomhaven sat two cells away.
  const shelvedAll = new Set(cells.flatMap((c) => c.chosen.map((i) => c.games[i])));
  const wouldBeThrownBack = (game) => {
    for (const other of ix.thin.get(game) ?? []) if (shelvedAll.has(other)) return true;
    for (const other of ix.kin.get(game) ?? []) {
      if (shelvedAll.has(other) && ix.rank[other] < ix.rank[game]) return true;
    }
    return false;
  };

  return cells.map((cell) => {
    const picks = cell.chosen.map((i) => cell.games[i]);
    const chosen = new Set(picks);
    // Who is next, which is whoever would add the most to the shelf as it now
    // stands — not whoever is best known. `scoreAll` reads the cell's uncovered
    // chart, so after the last pick it answers exactly that question. Ordering
    // these by rank called the most famous leftover "on deck" when it might add
    // nothing at all.
    const queue = [];
    if (alternatesLimit) {
      const scores = scorer.scoreAll(cell);
      for (let i = 0; i < cell.games.length; i++) {
        const g = cell.games[i];
        if (chosen.has(g) || taken.has(g) || wouldBeThrownBack(g)) continue;
        queue.push([g, scores[i]]);
      }
      queue.sort((a, b) => (b[1] - a[1]) || (ix.rank[a[0]] - ix.rank[b[0]]));
      queue.length = Math.min(queue.length, alternatesLimit);
    }
    return {
      key: cell.key, column: cell.column, row: cell.row,
      candidateCount: cell.games.length,
      picks,
      gains: picks.map((g) => gains.get(`${cell.key}|${g}`) ?? null),
      alternates: queue.map(([g]) => g),
      alternateGains: queue.map(([, v]) => v),
    };
  });
}
