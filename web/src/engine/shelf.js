/**
 * The reader's collection as a whole, rather than cell by cell.
 *
 * The grid asks "what belongs at four players, medium weight?". This asks the
 * other question: across everything you own, what kinds of game are you
 * actually covered for? Cell membership is deliberately absent — a shelf is not
 * played at one player count — so a game contributes its full quality-scaled
 * loading here where the grid would scale it by how well it fits a cell.
 *
 * This is the same maths `pipeline/collection.py` runs with no axes at all: one
 * cell holding the whole space.
 */


/** Per group, a game's quality-scaled loading. No membership: the shelf is the cell. */
export function spokeVector(ix, weights, game, nGroups) {
  const out = new Array(nGroups).fill(0);
  for (let k = ix.embedding.start[game]; k < ix.embedding.start[game + 1]; k++) {
    out[ix.groupOf[ix.embedding.idx[k]]] += weights[k];
  }
  return out;
}

/**
 * A set covers a place unless every game in it misses: 1 − ∏(1 − wᵢ).
 *
 * Per place, unweighted — the caller decides what a place is worth, because the
 * same function serves the twelve spokes of the radar and the seventy-seven
 * axes everything is actually measured on.
 */
export function coverageOf(vectors, nGroups) {
  const out = new Array(nGroups).fill(1);
  for (const v of vectors) {
    for (let i = 0; i < nGroups; i++) out[i] *= 1 - Math.min(v[i], 1);
  }
  return out.map((v) => 1 - v);
}

/**
 * That coverage totalled, with each axis worth what it is worth.
 *
 * The one place a per-axis total is taken, so picking and reporting cannot drift
 * apart the way they did when one summed spokes and the other summed axes.
 */
export function totalOf(ix, covered) {
  let sum = 0;
  for (let a = 0; a < covered.length; a += 1) sum += covered[a] * ix.axisWeight[a];
  return sum;
}

/** A game's own vector across the raw axes, quality already in it. */
export function axisVector(ix, weights, game, nAxes = ix.axisNames.length) {
  const out = new Float64Array(nAxes);
  for (let k = ix.embedding.start[game]; k < ix.embedding.start[game + 1]; k++) {
    out[ix.embedding.idx[k]] = weights[k];
  }
  return out;
}

/**
 * What a set of games covers, as one number.
 *
 * Every "how much would be lost without this" in the app is a difference of two
 * of these, so there is one definition of covered and one place it is summed.
 */
export function covers(ix, weights, rows) {
  const n = ix.axisNames.length;
  return totalOf(ix, coverageOf(rows.map((g) => axisVector(ix, weights, g, n)), n));
}

/**
 * What the shelf covers, where it is thin, and what would fill it.
 *
 * `gapThreshold` is a reporting choice, not a model one — it decides what is
 * worth mentioning, never what gets picked.
 */
export function analyseShelf(ix, weights, ownedRows, {
  gapThreshold = 0.5, suggestionsPerGap = 3, bannedRows = new Set(),
} = {}) {
  const nGroups = ix.groups.length;
  const owned = [...ownedRows];
  const vectors = owned.map((g) => spokeVector(ix, weights, g, nGroups));
  const coverage = coverageOf(vectors, nGroups);
  const total = coverage.reduce((a, b) => a + b, 0);

  // How much coverage would vanish without each game. The honesty stat: an
  // excellent game surrounded by near-neighbours contributes almost nothing,
  // which is exactly what somebody deciding what to sell needs to see.
  const unique = owned.map((game, i) => {
    const without = coverageOf(vectors.filter((_, j) => j !== i), nGroups);
    return {
      id: ix.ids[game], name: ix.names[game], rank: ix.rank[game],
      coverage: vectors[i].map((v) => Math.round(v * 1000) / 1000),
      unique: Math.round((total - without.reduce((a, b) => a + b, 0)) * 1000) / 1000,
    };
  }).sort((a, b) => a.unique - b.unique);

  const held = new Set(owned);
  const gaps = [];
  for (let s = 0; s < nGroups; s++) {
    if (coverage[s] >= gapThreshold) continue;
    const room = 1 - coverage[s];
    const fills = [];
    for (let g = 0; g < ix.n; g++) {
      if (held.has(g) || bannedRows.has(g)) continue;
      const v = spokeVector(ix, weights, g, nGroups)[s];
      if (v > 0) fills.push({ score: v * room, game: g });
    }
    fills.sort((a, b) => b.score - a.score);
    gaps.push({
      group: s,
      name: ix.groups[s].name,
      coverage: Math.round(coverage[s] * 1000) / 1000,
      suggestions: fills.slice(0, suggestionsPerGap).map(({ game }) => ({
        id: ix.ids[game], name: ix.names[game], rank: ix.rank[game],
      })),
    });
  }

  return {
    coverage: coverage.map((v) => Math.round(v * 1000) / 1000),
    total: Math.round(total * 10) / 10,
    spokes: nGroups,
    unique,
    gaps: gaps.sort((a, b) => a.coverage - b.coverage),
  };
}

/**
 * The same game twice, under two names.
 *
 * Identity, not likeness — so it is a lookup rather than a threshold. BGG
 * publishes both relations and the contract already carries them: `kin` is its
 * `reimplements` link (1,840 of them) and `thin` is a same-family pair where one
 * game's signals are a subset of the other's, which is the same game more fully
 * recorded.
 *
 * A similarity threshold cannot do this job, measured:
 *
 *     kin? thin?  similarity   pair
 *       Y    Y     0.79       7 Wonders / 7 Wonders (Second Edition)
 *       Y    ·     0.97       Brass: Lancashire / Birmingham
 *       ·    ·     0.00       Navegador / Orléans
 *
 * Any floor low enough to catch a second edition at 0.79 also catches games that
 * merely sit in the same twelve spokes. This used to measure spoke containment
 * and reported Navegador as 96% covered by Orléans — two economic games with
 * almost no mechanism in common — while the selector, scoring on the raw axes,
 * put them at 0.00 and was right.
 *
 * Returns nothing when nothing is a reissue of anything, which is the honest
 * answer for most shelves and the whole point of not listing the weakest few.
 */
export function redundancies(ix, rows, { limit = 8 } = {}) {
  const held = new Set(rows);
  const out = [];

  for (const row of rows) {
    // `thin` already points from the sparser record to the fuller one, so its
    // direction is the answer. `kin` is undirected, and the rule for it is the
    // one `rerecordings` in allocate.js applies: the less well known goes.
    const fuller = [...(ix.thin.get(row) ?? [])].filter((o) => o !== row && held.has(o));
    const lineage = (ix.kin.get(row) ?? [])
      .filter((o) => o !== row && held.has(o) && ix.rank[o] < ix.rank[row]);
    const backLineage = rows.filter((o) => o !== row
      && (ix.kin.get(o) ?? []).includes(row) && ix.rank[o] < ix.rank[row]);

    const by = fuller[0] ?? lineage[0] ?? backLineage[0];
    if (by === undefined) continue;
    out.push({
      id: ix.ids[row], row, name: ix.names[row], rank: ix.rank[row],
      filledBy: { id: ix.ids[by], row: by, name: ix.names[by], rank: ix.rank[by] },
      why: fuller.length ? 'recorded' : 'reissue',
    });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/*
 * `contributions` and `prunable` used to live here.
 *
 * Both reported a share of one shelf's weighted-axis coverage — "this game
 * holds 3%", or "these three together hold 12.9% against Final Girl's 11.4%" —
 * and a share of a space the reader has never been shown is a number nobody can
 * act on. Removed on request, along with the two rail findings and the per-game
 * bar that were their only callers.
 *
 * Worth keeping from them, because it cost a measurement: **the two spaces do
 * not agree, and the axes are the honest one.** Asked over the 12 spokes this
 * collection's games spread 64x apart — Telestrations 0.15%, Toy Battle 0.99% —
 * which reads as some games barely earning their place. Asked over the 77 axes
 * they spread 2x: 1.86% and 1.95%. Every game went in because it added the most
 * at the time, so of course they contribute alike; the 64x was twelve groups
 * standing in for seventy-seven and losing what told them apart. Anything built
 * to replace these runs on `covers` and `totalOf` above, not on the spokes.
 *
 * What the rail should answer instead is an open question — see BUGS.md.
 */

/**
 * Which kinds of play a collection holds more of than it needs.
 *
 * Per axis, take the games that touch it, strongest first, and ask how few of
 * them get you `enough` of the coverage all of them together give. The rest are
 * surplus *on that axis* — which is not the same as unwanted, since a game
 * surplus here may be the only thing carrying somewhere else. A game surplus on
 * every axis it touches is carrying nothing the rest does not.
 *
 * On the raw axes, not the twelve families: per-axis cohesion is 3.11x against
 * 2.52x, and "four of your games do worker placement with dice workers" is a
 * sentence worth reading where "four of your games are Abstract Strategy ·
 * Pattern Building" is not.
 */
export function overRepresented(ix, rows, { enough = 0.95, minGames = 3 } = {}) {
  const byAxis = new Map();
  for (const row of rows) {
    for (let k = ix.embedding.start[row]; k < ix.embedding.start[row + 1]; k++) {
      const axis = ix.embedding.idx[k];
      if (!byAxis.has(axis)) byAxis.set(axis, []);
      byAxis.get(axis).push({ row, value: ix.embedding.val[k] });
    }
  }

  const surplusOn = new Map();          // game row -> how many axes it is surplus on
  const touches = new Map();            // game row -> how many axes it touches
  const axes = [];

  for (const [axis, games] of byAxis) {
    for (const g of games) touches.set(g.row, (touches.get(g.row) ?? 0) + 1);
    if (games.length < minGames) continue;

    games.sort((a, b) => b.value - a.value);
    const cover = (n) => 1 - games.slice(0, n)
      .reduce((p, g) => p * (1 - Math.min(g.value, 1)), 1);
    const total = cover(games.length);
    if (!(total > 0)) continue;

    let need = games.length;
    for (let n = 1; n <= games.length; n++) {
      if (cover(n) >= enough * total) { need = n; break; }
    }
    if (need >= games.length) continue;

    for (const g of games.slice(need)) surplusOn.set(g.row, (surplusOn.get(g.row) ?? 0) + 1);
    axes.push({
      axis,
      name: ix.axisNames[axis],
      held: games.length,
      need,
      spare: games.slice(need).map((g) => g.row),
    });
  }

  return { axes: axes.sort((a, b) => (b.held - b.need) - (a.held - a.need)) };
}

/*
 * Four measures were tried for "which single game is carrying least", and none
 * of them separates. Recorded so nobody spends the afternoon again:
 *
 *   spoke containment       degenerate — divides by quality-scaled spoke mass,
 *                           so a thinly covered game is trivially "contained".
 *                           Read Hitster/Captain Sonar at 98% on 0.00 similarity.
 *   marginal coverage,      never penalises duplication: two near-twins each
 *   twelve spokes           raise 1 - prod(1 - w), so removing either costs
 *                           plenty. Gloomhaven scored second highest while 83%
 *                           duplicated.
 *   marginal coverage,      same failure, finer. Range 0.452-0.776 over twenty
 *   seventy-seven axes      games, and the Gloomhaven pair sits at the *top*.
 *   share of profile on     does not separate: 1-12% across the collection, and
 *   over-represented axes   it ranks Ark Nova first and Brass: Lancashire
 *                           eighth, which is backwards.
 *
 * The reason is structural rather than incidental: a coverage objective is
 * submodular, and a duplicate is cheap to remove only once its twin is *also*
 * gone. Asked about one game at a time, the twin's presence is exactly what
 * makes the arithmetic say "expensive".
 *
 * What does work is asking about pairs (`redundancies`) and about axes
 * (`overRepresented`). Both are shipped. A per-game ranking needs a measure
 * that is not coverage — most likely one that looks at the pair structure
 * first and attributes to a game second.
 */
