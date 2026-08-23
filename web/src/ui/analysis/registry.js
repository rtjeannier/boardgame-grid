/**
 * An analysis is a module, not a place.
 *
 * Each one computes from the built collection and renders itself. A `Panel` can
 * host one, a page can host several, and a future page of its own can host a
 * single one — none of which the analysis knows about. That is the whole point:
 * the side panel used to be four hard-coded blocks, so "put this on its own
 * page" meant rewriting it rather than moving it.
 *
 *   { id, scope, run({ built, state }), View({ data, built, state, actions, onOpen }) }
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

export function register(analysis) {
  REGISTRY.push(analysis);
  return analysis;
}

/** Every analysis with something to say about this collection, in order. */
export function analyse({ built, state }) {
  const out = [];
  for (const analysis of REGISTRY) {
    if (analysis.scope === 'mine' && !state.owned.length) continue;
    const data = analysis.run({ built, state });
    if (data == null) continue;
    out.push({ analysis, data });
  }
  return out;
}

export const all = () => [...REGISTRY];
