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

/** A set covers a spoke unless every game in it misses: 1 − ∏(1 − wᵢ). */
export function coverageOf(vectors, nGroups) {
  const out = new Array(nGroups).fill(1);
  for (const v of vectors) {
    for (let i = 0; i < nGroups; i++) out[i] *= 1 - Math.min(v[i], 1);
  }
  return out.map((v) => 1 - v);
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
 * Which games the collection is holding twice.
 *
 * For each shelved game, the share of *its own* profile that a single other
 * shelved game already covers. Not "how much coverage vanishes without it":
 * coverage is 1 − ∏(1 − wᵢ), so two copies of the same thing genuinely raise it
 * and removing either still loses plenty. Measured over a sixteen-game shelf,
 * Gloomhaven scored second-highest on that measure while being 83% duplicated.
 *
 * Containment answers the question actually asked — whose role is already being
 * filled — and it is asymmetric, which is what decides who goes: Jaws of the
 * Lion is 95% covered by Gloomhaven and Gloomhaven only 83% covered by Jaws of
 * the Lion, so Jaws of the Lion is the redundant one.
 *
 * Returns nothing when nothing is redundant, which is the honest answer for a
 * two-game shelf and the whole point of not simply listing the weakest few.
 */
export function redundancies(ix, weights, rows, { floor = 0.9, limit = 8 } = {}) {
  const nGroups = ix.groups.length;
  const vectors = rows.map((g) => spokeVector(ix, weights, g, nGroups));
  const totals = vectors.map((v) => v.reduce((a, b) => a + b, 0));

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (!(totals[i] > 0)) continue;
    let best = -1;
    let bestShare = 0;
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      let shared = 0;
      for (let s = 0; s < nGroups; s++) shared += Math.min(vectors[i][s], vectors[j][s]);
      const share = shared / totals[i];
      if (share > bestShare) { bestShare = share; best = j; }
    }
    if (best < 0 || bestShare < floor) continue;

    // Both sides of a pair can clear the bar. The more contained one is the
    // redundant one; where they tie, the less well known goes.
    let backShare = 0;
    for (let s = 0; s < nGroups; s++) {
      backShare += Math.min(vectors[best][s], vectors[i][s]);
    }
    backShare /= totals[best] || 1;
    if (backShare > bestShare
      || (backShare === bestShare && ix.rank[rows[best]] > ix.rank[rows[i]])) continue;

    out.push({
      id: ix.ids[rows[i]], row: rows[i], name: ix.names[rows[i]], rank: ix.rank[rows[i]],
      filledBy: {
        id: ix.ids[rows[best]], row: rows[best],
        name: ix.names[rows[best]], rank: ix.rank[rows[best]],
      },
      share: bestShare,
    });
  }
  return out.sort((a, b) => b.share - a.share).slice(0, limit);
}
