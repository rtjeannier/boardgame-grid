"""Embed games in a continuous feature space.

The "genre" of a game isn't one label — a game can be mostly worker-placement
with a dose of engine-building. We recover that structure from the data:

  1. Build a game × signal incidence matrix from BGG mechanic/category names,
     IDF-weighted so ubiquitous signals (Hand Management) count less than
     distinctive ones (Hidden Roles, Flicking). The weighting is sublinear:
     BGG tags are polysemous, so an undamped IDF lets one rare tag hijack a
     game's genre (see the note in `_genre_loadings`).
  2. Factor it with NMF into latent *genre dimensions*. NMF loadings are
     non-negative, so "this game is 0.7 of dimension 3" reads naturally, and
     each dimension is nameable by its top-loading signals.
  3. Normalise each game's loadings to sum to 1 — a genre *split*, not a genre
     *amount* — then shrink that split toward "unknown" for games too little
     read to trust (see `_shrink`).
  4. A game's full vector = its genre loadings plus mildly scaled weight and
     log-playtime.

The result feeds two consumers: MMR coverage selection (pipeline/assign.py)
and a global 2-D PCA projection the frontend scatters per cell.
"""

from dataclasses import dataclass

import numpy as np
from sklearn.decomposition import NMF, PCA

from .config import (
    GENRE_TOP_SIGNALS,
    LOADING_SHRINKAGE,
    NMF_COMPONENTS,
    PLAYTIME_SCALE,
    WEIGHT_SCALE,
)
from .model import Game


@dataclass
class FeatureSpace:
    vectors: dict[int, np.ndarray]        # game id -> full feature vector
    loadings: dict[int, np.ndarray]       # game id -> genre loadings only (the radar axes)
    projection: dict[int, tuple[float, float]]  # game id -> global 2-D (x, y)
    top_genres: dict[int, list[tuple[str, float]]]  # id -> [(dim name, loading)]
    dimension_names: list[str]            # one per latent genre dimension
    similarity: dict[int, np.ndarray]     # id -> unit-norm FULL-space tag vector


def build_feature_space(games: list[Game]) -> FeatureSpace:
    ids = [g.id for g in games]

    genre = _genre_loadings(games)              # (n_games, n_dims), rows normalised
    dim_names = genre["names"]
    loadings = genre["loadings"]

    # Continuous stats, z-scored then scaled down so genre dominates distances.
    weight = _zscore(np.array([g.weight for g in games])) * WEIGHT_SCALE
    playtime = _zscore(np.log1p([g.playtime for g in games])) * PLAYTIME_SCALE

    matrix = np.column_stack([loadings, weight, playtime])

    # One coherent 2-D map of the whole population for the frontend scatter.
    xy = PCA(n_components=2, random_state=0).fit_transform(matrix)

    top = {
        gid: _top_dims(loadings[i], dim_names)
        for i, gid in enumerate(ids)
    }
    return FeatureSpace(
        vectors={gid: matrix[i] for i, gid in enumerate(ids)},
        loadings={gid: loadings[i] for i, gid in enumerate(ids)},
        projection={gid: (round(float(x), 3), round(float(y), 3)) for gid, (x, y) in zip(ids, xy)},
        top_genres=top,
        dimension_names=dim_names,
        similarity=_similarity_space(games),
    )


def _similarity_space(games: list[Game]) -> dict[int, np.ndarray]:
    """Unit-norm IDF-weighted tag vectors, in the FULL space — no NMF.

    Used only to answer "are these two the same game?", never to place a game on
    the radar. The distinction matters: cosine on the 10-dim NMF loadings cannot
    tell a duplicate from a same-genre neighbour — Decrypto/Monikers (unrelated)
    score 0.972 there, *above* Twilight Imperium 3rd/4th at 0.967, because the
    bottleneck discards exactly the detail that separates them. In the full space
    those become 0.234 and 0.807, which does separate them.

    Families join the vocabulary here (and only here) because they roughly double
    that separation.
    """
    tokens = {g.id: list(g.signals) + list(g.families) for g in games}
    vocab = sorted({t for v in tokens.values() for t in v})
    index = {t: j for j, t in enumerate(vocab)}

    matrix = np.zeros((len(games), len(vocab)))
    for i, g in enumerate(games):
        for t in tokens[g.id]:
            matrix[i, index[t]] = 1.0

    matrix *= 1 + np.log1p(len(games) / matrix.sum(axis=0))   # same damped IDF
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix /= norms
    return {g.id: matrix[i] for i, g in enumerate(games)}


def _genre_loadings(games: list[Game]) -> dict:
    """NMF the IDF-weighted game×signal matrix into named genre dimensions."""
    vocab = sorted({s for g in games for s in g.signals})
    index = {s: j for j, s in enumerate(vocab)}

    incidence = np.zeros((len(games), len(vocab)))
    for i, g in enumerate(games):
        for s in g.signals:
            incidence[i, index[s]] = 1.0

    # IDF: rare signals are more informative about what a game *is*. The curve
    # is deliberately *sublinear* — plain log(n/df) let a single rare tag decide
    # a game's whole identity, and BGG tags are polysemous: "Action Queue" means
    # programming combat cards in Gloomhaven and column action selection in
    # Wingspan. Weighted by plain IDF those two share a factor, and Wingspan's
    # top genre came out as "Line of Sight / Miniatures". Damping keeps rare
    # tags informative without letting them outvote everything a game actually
    # is. Do not "simplify" this back to np.log.
    doc_freq = incidence.sum(axis=0)
    idf = 1 + np.log1p(len(games) / doc_freq)
    weighted = incidence * idf

    n_dims = min(NMF_COMPONENTS, len(vocab))
    nmf = NMF(n_components=n_dims, init="nndsvda", max_iter=500, random_state=0)
    loadings = nmf.fit_transform(weighted)        # games × dims
    components = nmf.components_                  # dims × signals

    # Name each dimension by its most characteristic signals.
    names = []
    for row in components:
        best = np.argsort(row)[::-1][:GENRE_TOP_SIGNALS]
        names.append(" / ".join(vocab[j] for j in best if row[j] > 0))

    # L1-normalise per game: every game carries the same *total* genre mass, so
    # the vector says how a game divides itself between genres, not how much
    # genre it has. This has to be L1 because coverage sums across axes. Under
    # L2 the sum of squares is fixed, so total mass grows as sqrt(k) with the
    # number of axes a game touches — 3.16x for a ten-axis sprawl, which exceeds
    # the entire 2.5x range of `coverage.quality`. A bottom-ranked generalist
    # then outscores a #1 specialist and rank can never catch up, which is how
    # Brass: Birmingham lost its cell to a pile of eight-axis games.
    mass = loadings.sum(axis=1, keepdims=True)
    mass[mass == 0] = 1.0
    shares = loadings / mass

    return {"loadings": _shrink(shares, games), "names": names}


def _shrink(shares: np.ndarray, games: list[Game]) -> np.ndarray:
    """Blend each game's genre split toward "unknown" by how little it's been read.

    A one-tag game claims 100% of a genre the way a batter who went 1-for-1
    claims a 1.000 average — the number is real and the evidence isn't. Before
    this, every genre axis was owned by an obscure game (a 494-rating title held
    worker placement outright); after it they're held by Puerto Rico, Codenames,
    Azul and Power Grid.

    Weighted by ratings rather than tag count, because tag count cannot tell
    "few tags because unread" from "few tags because simple". SCOUT has four
    tags and 29k ratings — genuinely just a card game — and keeps 94% of its
    claim; tag-count weighting would have cut it to 40%.
    """
    rated = np.array([max(g.users_rated, 0) for g in games], dtype=float)[:, None]
    if not rated.any():
        # No attention data at all — the committed seed dataset predates the
        # field. Shrinking anyway would blend *every* game to a flat vector and
        # quietly produce a grid where all games look identical, so take the
        # loadings at face value instead: no evidence about the evidence.
        return shares

    n_axes = shares.shape[1]
    unknown = np.full(n_axes, 1.0 / n_axes)
    believed = rated / (rated + LOADING_SHRINKAGE)

    shrunk = believed * shares + (1.0 - believed) * unknown
    return shrunk / shrunk.sum(axis=1, keepdims=True)


def _top_dims(row: np.ndarray, names: list[str], k: int = 3) -> list[tuple[str, float]]:
    """A game's strongest genre dimensions, for display: [(name, loading)]."""
    order = np.argsort(row)[::-1][:k]
    return [(names[j], round(float(row[j]), 2)) for j in order if row[j] > 0.05]


def _zscore(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    std = values.std()
    return (values - values.mean()) / (std if std > 0 else 1.0)
