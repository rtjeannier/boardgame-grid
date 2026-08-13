// Frontend mirror of pipeline/coverage.py's axis_coverage: a set of games
// covers an axis unless every one of them misses it — 1 − ∏(1 − wᵢ).
export function axisCoverage(vectors, n) {
  return Array.from({ length: n }, (_, i) =>
    1 - vectors.reduce((acc, v) => acc * (1 - (v?.[i] ?? 0)), 1),
  )
}
