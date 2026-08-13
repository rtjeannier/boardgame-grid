// Frontend mirror of pipeline/coverage.py's axis_coverage: a set of games
// covers an axis unless every one of them misses it — 1 − ∏(1 − wᵢ).
export function axisCoverage(vectors, n) {
  return Array.from({ length: n }, (_, i) =>
    1 - vectors.reduce((acc, v) => acc * (1 - (v?.[i] ?? 0)), 1),
  )
}

// One member's slice of the final radar shape: the band between what the
// games before it (in pick order) already covered and that coverage with it
// added. These are the diminishing marginal contributions — stacked in order
// they sum exactly to the full polygon, so a member's band always lies inside
// the final shape, never outside it.
export function contributionBand(vectors, index, n) {
  const before = vectors.slice(0, index)
  return {
    inner: axisCoverage(before, n),
    outer: axisCoverage([...before, vectors[index]], n),
  }
}
