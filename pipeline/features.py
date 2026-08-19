"""Embed games in a continuous feature space.

The "genre" of a game isn't one label — a game can be mostly worker-placement
with a dose of engine-building. We recover that structure from the data:

  1. Build a game × signal incidence matrix from BGG mechanic/category names.
  2. Cluster the *signals* by co-occurrence to discover genres, and take each
     cluster as one radar axis (see `_harvest_cores`). Axes are therefore named
     with the actual BGG tags that define them, not with whatever a latent
     factor happened to load on.
  3. Each game's loadings = how its tags divide across those axes, normalised to
     sum to 1 — a genre *split*, not a genre *amount*.
  4. A game's full vector = its genre loadings plus mildly scaled weight and
     log-playtime.

The result feeds two consumers: MMR coverage selection (pipeline/assign.py)
and a global 2-D PCA projection the frontend scatters per cell.

This replaced NMF over an IDF-weighted matrix, for two reasons. Latent factors
could not be named honestly — Wingspan's top genre came out as "Line of Sight /
Miniatures" — and NMF cannot find a genre smaller than about 150 games at any
`k`, so `Action / Dexterity` (120 games) and `Trick-taking` (89) had no axis at
any corpus depth. Measured end-to-end on the 5000-game capture, the switch left
149 of 167 grid picks unchanged, moved median pick rank 214 -> 222, and took
same-axis agreement on known same-core game pairs from 4/5 to 5/5.

Do not read this file's clustering as a duplicate of `_similarity_space` below
and unify them — they answer different questions and are weighted oppositely on
purpose. Axes ask "what regions of game-space exist", so tags group by raw
co-occurrence. Similarity asks "are these two games substitutes", where only a
game's *core* tags should count, so it weights by centrality instead.
"""

from dataclasses import dataclass

import numpy as np
from scipy.cluster.hierarchy import linkage
from sklearn.decomposition import PCA

from .config import (
    GENRE_AXIS_TARGET,
    GENRE_NAME_SEPARATOR,
    GENRE_TOP_SIGNALS,
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
    """Unit-norm centrality-weighted tag vectors, in the FULL tag space.

    Used only to answer "are these two the same game?", never to place a game on
    the radar. The distinction matters because the genre axes have no room to
    answer it: across random pairs of games their cosine averages 0.823, since
    fifteen axes leave everything a little like everything. A real
    re-implementation cannot stand out against that floor — Twilight Imperium
    3rd/4th score 0.973 there, which is merely the 91st percentile. In the full
    tag space the bulk drops to 0.124 and the same pair reaches the 99.9th,
    which is the separation `coverage.novelty` needs to act on.

    Families join the vocabulary here (and only here) because they roughly double
    that separation.
    """
    tokens = {g.id: set(g.signals) | set(g.families) for g in games}
    vocab = sorted({t for v in tokens.values() for t in v})
    index = {t: j for j, t in enumerate(vocab)}

    present = np.zeros((len(games), len(vocab)))
    for i, g in enumerate(games):
        for t in tokens[g.id]:
            present[i, index[t]] = 1.0

    matrix = present * _tag_centrality(present)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return {g.id: matrix[i] / norms[i] for i, g in enumerate(games)}


def _tag_centrality(present: np.ndarray) -> np.ndarray:
    """Per (game, tag): how central that tag is to *that* game.

    A game's tags are not equally load-bearing. 7 Wonders is a set-collection
    drafting card game with unusual end conditions — `Set Collection` is what it
    *is*, `Tug of War` is a quirk of how it ends. Weighting every tag alike made
    two games agree only in proportion to their trivia.

    Centrality is how well a tag sits with the game's *other* tags, measured by
    how often tags co-occur across the corpus. So the mechanics that make a game
    the kind of thing it is dominate, and the one-off flourishes fade.

    Note this deliberately favours *common* tags over rare ones, which is the
    opposite of IDF. That is the point: the shared core is what makes two games
    substitutes for each other, and IDF measures the flourishes. Weighting by
    distinctiveness instead put `Melding and Splaying` above `Set Collection`
    for 7 Wonders, and rated Race/Roll for the Galaxy as more alike than the two
    7 Wonders Duel games, which is backwards.

    This is also why the radar axes do not reuse these weights: `_harvest_cores`
    groups tags by plain co-occurrence, because "which regions of game-space
    exist" is a different question from "are these two games substitutes".
    """
    # Tag-tag relatedness: two tags are alike if they mark the same games.
    co = present.T @ present
    scale = np.sqrt(np.diag(co))
    scale[scale == 0] = 1.0
    related = co / np.outer(scale, scale)
    np.fill_diagonal(related, 0.0)          # a tag cannot vouch for itself

    # Mean relatedness to the game's other tags.
    degree = present.sum(axis=1, keepdims=True)
    centrality = (present @ related) / np.maximum(degree - 1, 1)

    # A one-tag game has no "other tags" to be central to; its single tag is by
    # definition its whole identity, so give it full weight rather than zero.
    return np.where(degree > 1, centrality, 1.0)


def _genre_loadings(games: list[Game]) -> dict:
    """Cluster signals into genres, then split each game across them."""
    vocab = sorted({s for g in games for s in g.signals})
    index = {s: j for j, s in enumerate(vocab)}

    incidence = np.zeros((len(games), len(vocab)))
    for i, g in enumerate(games):
        for s in g.signals:
            incidence[i, index[s]] = 1.0

    cores = _harvest_cores(incidence, GENRE_AXIS_TARGET)
    membership = _assign_signals(incidence, cores)

    names = [_name_core(core, incidence, vocab) for core in cores]

    # How each game's tags divide across the axes, then L1-normalised: every
    # game carries the same *total* genre mass, so the vector says how a game
    # divides itself between genres, not how much genre it has. This has to be
    # L1 because coverage sums across axes. Under L2 the sum of squares is
    # fixed, so total mass grows as sqrt(k) with the number of axes a game
    # touches — 3.16x for a ten-axis sprawl, which exceeds the entire 2.5x range
    # of `coverage.genre_quality`. A bottom-ranked generalist then outscores a #1
    # specialist and rank can never catch up, which is how Brass: Birmingham
    # lost its cell to a pile of eight-axis games.
    loadings = incidence @ membership
    mass = loadings.sum(axis=1, keepdims=True)
    # Only a game carrying no signals at all can be zero here — every signal
    # belongs to exactly one axis (see `_assign_signals`). Such a game covers
    # no genre at all and is never picked, which is the honest reading of "we
    # know nothing about this one".
    mass[mass == 0] = 1.0
    shares = loadings / mass

    return {"loadings": shares, "names": names}


def _harvest_cores(incidence: np.ndarray, target: int) -> list[list[int]]:
    """Find `target` groups of signals that genuinely co-occur.

    Each signal is a unit vector over the games carrying it, so the cosine
    between two signals is how much they co-occur, and a *group's* cohesion is
    the mean cosine over its pairs. Agglomerate the signals, then harvest the
    **maximal** subtrees that still hang together: walk down from the root and
    accept a node as soon as it is cohesive enough, so each axis is the largest
    group that is still one genre rather than the tightest pair inside it.

    Crucially this does *not* partition the signals. Cutting the tree into
    exactly `target` clusters forces every signal somewhere, and the weakly
    correlated ones pile into a single residual drawer — measured at 424 signals
    reaching 4335 of 5000 games, which swallowed dexterity whole. (Splitting
    over-broad tags into interaction terms first does not help; it only moves
    the drawer.) Leaving the incoherent tail unharvested is what removes it;
    `_assign_signals` then places the tail, so nothing is actually lost.

    A group only counts as a genre if it is some game's *primary* genre, for at
    least a tenth of the games an even split would give it. Reach — how many
    games carry any of its signals — is not enough on its own: `Age of Reason ·
    American Revolutionary War` reached 76 games and passed every size test
    going, yet exactly *one* game in 5000 was more that than anything else. It
    described nothing, while taking a fifteenth of the chart. Genres that no
    game actually belongs to are dropped here.

    `target` is the only input. It sets the ceiling on reach (no group may span
    more than ten times an even share, or it is not a genre), the floor on
    primary games, and — through bisection — the cohesion threshold, which is
    whatever makes exactly `target` groups survive.
    """
    n_games, n_signals = incidence.shape
    max_reach = n_games / target * 10
    min_primary = n_games / target / 10

    vectors = incidence.T / np.maximum(
        np.linalg.norm(incidence.T, axis=1, keepdims=True), 1e-9
    )
    tree = linkage(vectors, method="ward")

    # Walking the tree, each node carries its members, the *sum* of its members'
    # unit vectors and the games it reaches. The sum is what makes this cheap:
    # mean pairwise cosine is (|S|^2 - m) / (m(m-1)), so cohesion costs O(1) per
    # node instead of O(m^2), and the whole search is a single pass.
    members = {j: [j] for j in range(n_signals)}
    totals = {j: vectors[j].copy() for j in range(n_signals)}
    reached = {j: incidence[:, j] > 0 for j in range(n_signals)}
    children: dict[int, tuple[int, int]] = {}
    cohesion = {j: 1.0 for j in range(n_signals)}

    for step, (a, b, _, _) in enumerate(tree):
        a, b = int(a), int(b)
        node = n_signals + step
        children[node] = (a, b)
        members[node] = members[a] + members[b]
        totals[node] = totals[a] + totals[b]
        reached[node] = reached[a] | reached[b]
        size = len(members[node])
        cohesion[node] = (float(totals[node] @ totals[node]) - size) / (size * (size - 1))

    root = n_signals + len(tree) - 1

    def harvest(threshold: float) -> list[list[int]]:
        found, stack = [], [root]
        while stack:
            node = stack.pop()
            if node < n_signals:
                continue                  # a lone signal is not a genre
            if cohesion[node] < threshold or reached[node].sum() > max_reach:
                stack.extend(children[node])
                continue
            found.append(members[node])
        return found

    def genres(threshold: float) -> list[tuple[int, list[int]]]:
        """Harvest, then keep only the groups some games primarily belong to."""
        cores = harvest(threshold)
        if not cores:
            return []
        loadings = incidence @ _assign_signals(incidence, cores)
        held = loadings.sum(axis=1) > 0
        counts = np.bincount(np.argmax(loadings[held], axis=1), minlength=len(cores))
        return sorted(
            ((int(n), core) for n, core in zip(counts, cores) if n >= min_primary),
            key=lambda pair: -pair[0],
        )

    low, high = 0.0, 1.0
    for _ in range(40):
        mid = (low + high) / 2
        if len(genres(mid)) < target:
            high = mid
        else:
            low = mid

    # Several groups can qualify at the same threshold, so this lands on "at
    # least `target`"; keep the ones the most games actually belong to.
    return [core for _, core in genres(low)[:target]]


def _assign_signals(incidence: np.ndarray, cores: list[list[int]]) -> np.ndarray:
    """(n_signals x n_axes) map placing *every* signal on exactly one axis.

    The harvested cores define the genres; every signal left over joins the core
    it most resembles. Without this the axes only span the cores — 32 of 274
    signals — and 633 games carry no signal on any axis. Those games are not
    merely unplaced — with no genre at all they can never be picked, whatever
    they are. Attraction drops that from 633 games to 1, the only game in the
    capture with no signals at all.

    A signal joins one axis but does not count fully towards it. Its weight is
    how *diagnostic* it is: of the games carrying this signal, the share that
    really sit in that genre. Cross-cutting signals therefore barely register
    while defining ones count outright — `Team-Based Game` spans 356 games and
    scores 0.15 on the traitor-game axis, `Flicking` spans 30 and scores 0.93 on
    dexterity. Core signals score exactly 1.0 and need no special case: every
    game carrying a core signal is in that core by definition.

    Without this a signal counted the same wherever it landed, and any game with
    a broad tag was dragged towards a genre it has nothing to do with. Crokinole
    — `Action / Dexterity`, `Flicking`, `Team-Based Game` — split 0.67 dexterity
    against 0.33 traitor games, so owning the one great dexterity game still
    left that axis looking half empty. It now reads 0.93 against 0.07.
    """
    n_signals = incidence.shape[1]
    vectors = incidence.T / np.maximum(
        np.linalg.norm(incidence.T, axis=1, keepdims=True), 1e-9
    )
    centroids = np.stack([vectors[core].mean(axis=0) for core in cores])
    centroids /= np.maximum(np.linalg.norm(centroids, axis=1, keepdims=True), 1e-9)
    resemblance = vectors @ centroids.T

    home = np.argmax(resemblance, axis=1)
    for axis, core in enumerate(cores):
        home[core] = axis

    # Which games sit in each genre, judged by its core signals alone.
    in_genre = np.stack([incidence[:, core].sum(axis=1) > 0 for core in cores])

    membership = np.zeros((n_signals, len(cores)))
    for signal in range(n_signals):
        axis = int(home[signal])
        carriers = incidence[:, signal] > 0
        membership[signal, axis] = in_genre[axis][carriers].mean()
    return membership


def _name_core(core: list[int], incidence: np.ndarray, vocab: list[str]) -> str:
    """Name an axis after the most-used signals in its core.

    Core signals only — the attracted tail is placed by nearest neighbour and
    would blur the label. BGG ships some tags twice in different cases
    ("Real-time" and "Real-Time" are both live and cluster together), so a
    signal whose name is already present in any case is skipped rather than
    repeated back at the reader.
    """
    ordered = sorted(core, key=lambda j: -incidence[:, j].sum())
    chosen: list[str] = []
    seen: set[str] = set()
    for j in ordered:
        name = vocab[j]
        if name.casefold() in seen:
            continue
        seen.add(name.casefold())
        chosen.append(name)
        if len(chosen) == GENRE_TOP_SIGNALS:
            break
    return GENRE_NAME_SEPARATOR.join(chosen)


def _top_dims(row: np.ndarray, names: list[str], k: int = 3) -> list[tuple[str, float]]:
    """A game's strongest genre dimensions, for display: [(name, loading)]."""
    order = np.argsort(row)[::-1][:k]
    return [(names[j], round(float(row[j]), 2)) for j in order if row[j] > 0.05]


def _zscore(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    std = values.std()
    return (values - values.mean()) / (std if std > 0 else 1.0)
