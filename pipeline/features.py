"""Embed games in a continuous feature space.

The "genre" of a game isn't one label — a game can be mostly worker-placement
with a dose of engine-building. We recover that structure from the data:

  1. Build a game × signal incidence matrix from BGG mechanic/category names,
     IDF-weighted so ubiquitous signals (Hand Management) count less than
     distinctive ones (Hidden Roles, Flicking).
  2. Factor it with NMF into latent *genre dimensions*. NMF loadings are
     non-negative, so "this game is 0.7 of dimension 3" reads naturally, and
     each dimension is nameable by its top-loading signals.
  3. A game's full vector = its (L2-normalised) genre loadings plus mildly
     scaled weight and log-playtime.

The result feeds two consumers: MMR coverage selection (pipeline/assign.py)
and a global 2-D PCA projection the frontend scatters per cell.
"""

from dataclasses import dataclass

import numpy as np
from sklearn.decomposition import NMF, PCA

from .config import (
    GENRE_TOP_SIGNALS,
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
    )


def _genre_loadings(games: list[Game]) -> dict:
    """NMF the IDF-weighted game×signal matrix into named genre dimensions."""
    vocab = sorted({s for g in games for s in g.signals})
    index = {s: j for j, s in enumerate(vocab)}

    incidence = np.zeros((len(games), len(vocab)))
    for i, g in enumerate(games):
        for s in g.signals:
            incidence[i, index[s]] = 1.0

    # IDF: rare signals are more informative about what a game *is*.
    doc_freq = incidence.sum(axis=0)
    idf = np.log(len(games) / doc_freq)
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

    # L2-normalise per game so every game's genre identity has equal footing in
    # distances regardless of how many mechanics BGG lists for it.
    norms = np.linalg.norm(loadings, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return {"loadings": loadings / norms, "names": names}


def _top_dims(row: np.ndarray, names: list[str], k: int = 3) -> list[tuple[str, float]]:
    """A game's strongest genre dimensions, for display: [(name, loading)]."""
    order = np.argsort(row)[::-1][:k]
    return [(names[j], round(float(row[j]), 2)) for j in order if row[j] > 0.05]


def _zscore(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    std = values.std()
    return (values - values.mean()) / (std if std > 0 else 1.0)
