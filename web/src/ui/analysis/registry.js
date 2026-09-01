/**
 * An analysis is a module, not a place.
 *
 * Each one computes from the built collection and renders itself. A `Panel` can
 * host one, a page can host several, and a future page of its own can host a
 * single one — none of which the analysis knows about. That is the whole point:
 * the side panel used to be four hard-coded blocks, so "put this on its own
 * page" meant rewriting it rather than moving it.
 *
 *   { id, scope, run({ built, state, subject }), View({ data, built, state, ... }) }
 *
 * `subject` is what the analysis is about: `{ kind: 'collection' }` or
 * `{ kind: 'cell', cell }`. It is passed in rather than read off the state
 * because the same analysis renders in two places at once — the rail, which
 * describes the page, and an opened shelf, which describes that shelf. Reading
 * a "selected shelf" out of the state made both of them say the same thing.
 *
 * `run` returning `null` is how an analysis says it has nothing to say, and the
 * host renders nothing at all — not a heading over an empty list. That is the
 * shape of the invariant this is being built for: with no collection uploaded,
 * an analysis of your collection is silent.
 *
 * `scope` says what it is about. `collection` describes whatever is on screen;
 * `mine` describes the reader's own games and does not appear without them.
 *
 * There is one rendering, not a Summary and a Detail. A second would be
 * designing for a consumer that does not exist yet; when a page needs a
 * one-line form, that is the moment to add it.
 */

const REGISTRY = [];

/**
 * Registering the same analysis twice replaces it; it does not add it.
 *
 * The list outlives every component, so anything that evaluates a module a
 * second time — Vite re-executing it on save, one module graph reached under
 * two specifiers — used to append a second copy. The rail then rendered that
 * analysis twice under the same React key, and the radar grew by one every
 * save. Keying on `id` makes the list idempotent, which is what an import side
 * effect has to be.
 */
export function register(analysis) {
  const at = REGISTRY.findIndex((a) => a.id === analysis.id);
  if (at >= 0) REGISTRY[at] = analysis;
  else REGISTRY.push(analysis);
  return analysis;
}

/** Every analysis with something to say about this subject, in order. */
export function analyse({ built, state, subject = { kind: 'collection' } }) {
  const out = [];
  for (const analysis of REGISTRY) {
    if (analysis.scope === 'mine' && !state.owned.length) continue;
    const data = analysis.run({ built, state, subject });
    if (data == null) continue;
    out.push({ analysis, data });
  }
  return out;
}

export const all = () => [...REGISTRY];
