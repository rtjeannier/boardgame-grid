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
    GENRE_BASE_RATE,
    GENRE_COMPOUND,
    GENRE_GROWTH,
    GENRE_DISCOVER,
    GENRE_LIMIT,
    GENRE_MIN_COHESION,
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
    the radar. It is sharp at the top — across random pairs the cosine averages
    0.124, so a re-implementation stands right out: Twilight Imperium 3rd/4th
    reach the 99.9th percentile here.

    It deliberately does *not* judge whether two different games fill the same
    slot. Dune: Imperium and Lost Ruins of Arnak share deck building, worker
    placement and drafting yet score only 0.402, because their unshared theme
    tags dilute it. Judging that from the genre loadings instead was tried and
    reverted: the genre axes are not orthogonal enough to carry it — random
    pairs already average 0.35 there and reach 0.83 at the 95th percentile, so
    nothing separates a same-slot pair from ordinary resemblance.

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
    vocab, incidence = _signal_space(games)

    cores = _prune_nested(incidence, _harvest_cores(incidence, GENRE_AXIS_TARGET),
                          GENRE_LIMIT)
    membership = _assign_signals(incidence, cores)

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

    # Named last: a genre's label depends on which games ended up in it, so the
    # loadings have to exist first (see `_name_genres`).
    member = (shares >= 0.5 * shares.max(axis=1, keepdims=True)) & (shares > 0)
    names = _name_genres(cores, incidence, vocab, member)

    return {"loadings": shares, "names": names}


def _signal_space(games: list[Game]) -> tuple[list[str], np.ndarray]:
    """Game x signal incidence, plus a compound for each pair of base-rate tags.

    A tag carried by more of the corpus than one genre's even share cannot
    itself be a genre — `Hand Management` marks 1634 of 5000 games and `Card
    Game` 1483, and left to found genres they anchor one covering most of
    everything. Each pair of such tags therefore also becomes a signal in its
    own right: `Card Game + Hand Management`, `Tile Placement + Open Drafting`.
    A compound is specific enough to name a kind of game where neither half was,
    and two of the eight genres exist only because of them.

    The base tags are *kept* alongside their compounds, not replaced by them. A
    tag connects every game carrying it; a compound connects only games sharing
    that exact pair, and games pair the same tag differently — Dune: Imperium
    and Lost Ruins of Arnak both carry `Open Drafting`, but Dune pairs it with
    `Solo`/`Variable Player Powers` and Arnak with `Card Game`/`Fantasy`/`Hand
    Management`. Dropping the parent therefore halves how alike a tag's games
    look to each other: measured across all thirteen base tags, mean pairwise
    cosine among a tag's games falls from ~0.20 to ~0.10, with no tag spared.
    Compounds add specificity; only the parent carries commonality.

    The tempting check — are the parent's games still covered by its compounds?
    — is the wrong one. All thirteen come out 85-99% covered, which would say
    drop them all. It measures whether each *game* keeps some signal, not
    whether the *relationships between games* survive.

    Pairing *only* base tags with each other is what makes this work, and it
    took several wrong turns to find. Pairing them with ordinary tags instead
    shreds the ordinary tag into fragments that can only recombine into itself,
    because those fragments share it and nothing else: `Deck Construction`,
    `Horror` and `Humor` each came back as a "genre" reassembled from its own
    pieces, while dexterity, trick-taking and economic vanished entirely.
    """
    vocab = sorted({s for g in games for s in g.signals})
    index = {s: j for j, s in enumerate(vocab)}
    incidence = np.zeros((len(games), len(vocab)))
    for i, g in enumerate(games):
        for s in g.signals:
            incidence[i, index[s]] = 1.0

    carried = incidence.sum(axis=0)
    base = [j for j in range(len(vocab)) if carried[j] > len(games) * GENRE_BASE_RATE]
    floor = len(games) / GENRE_AXIS_TARGET / 10

    names = list(vocab)
    columns = [incidence[:, j] for j in range(len(vocab))]
    for a, first in enumerate(base):
        for second in base[a + 1:]:
            both = incidence[:, first] * incidence[:, second]
            if both.sum() >= floor:
                names.append(f"{vocab[first]}{GENRE_COMPOUND}{vocab[second]}")
                columns.append(both)
    return names, np.stack(columns, axis=1)


def _harvest_cores(incidence: np.ndarray, target: int) -> list[list[int]]:
    """Genres, tightest first: claim the most coherent group, then the next.

    Each signal is a unit vector over the games carrying it, so the cosine
    between two signals is how much they co-occur and a *group's* cohesion is
    the mean cosine over its pairs. Each round agglomerates whatever signals are
    still unclaimed, takes the tightest group that reaches enough games, grows
    it to its widest still-coherent extent, and removes it from the pool.

    Taking the tightest thing first is what stops a genre being founded on a
    seed and then accreting. Selecting by *coverage* instead — most games
    accounted for — hands round two to whichever pair happens to sit nearest the
    middle of the corpus, and everything broad then piles onto it: a two-tag
    `Set Collection · Open Drafting` seed grew into a 1142-game genre by
    absorbing hand management, worker placement and deck building, none of which
    its name mentions. Claiming tight groups first means a broad tag is taken by
    the genre that actually defines it, before any stub can collect it.

    Growth is relative: a group keeps widening while it holds `GENRE_GROWTH` of
    the tightness it started with. Absolute thresholds cannot work here because
    genres differ in how tight they naturally are — `Wargame · Simulation` opens
    at 0.63 and dexterity at 0.48, so a fixed bar either strangles one or lets
    the other swell to 86% of the corpus.

    What is left unclaimed goes to `_assign_signals`, which attaches it in
    coherent blocs rather than tag by tag.
    """
    n_games, n_signals = incidence.shape
    min_reach = n_games / target / 10

    claimed: list[list[int]] = []
    pool = list(range(n_signals))
    while len(claimed) < GENRE_DISCOVER and len(pool) > 1:
        found = _tightest(incidence[:, pool], min_reach)
        if found is None:
            break
        claimed.append([pool[i] for i in found])
        taken = set(claimed[-1])
        pool = [j for j in pool if j not in taken]
    return claimed


def _tightest(subset: np.ndarray, min_reach: float) -> list[int] | None:
    """The most cohesive group in `subset`, grown while it still hangs together.

    Returns column indices *into `subset`*, or None when nothing left reaches
    `min_reach` games. Cohesion is carried up the tree as a sum of unit vectors,
    so mean pairwise cosine is (|S|^2 - m) / (m(m-1)) and costs O(1) per node.
    """
    vectors = subset.T / np.maximum(np.linalg.norm(subset.T, axis=1, keepdims=True), 1e-9)
    tree = linkage(vectors, method="ward")
    leaves = len(vectors)

    members = {j: [j] for j in range(leaves)}
    totals = {j: vectors[j].copy() for j in range(leaves)}
    reached = {j: subset[:, j] > 0 for j in range(leaves)}
    cohesion = {j: 1.0 for j in range(leaves)}
    parent: dict[int, int] = {}

    for step, (a, b, _, _) in enumerate(tree):
        a, b = int(a), int(b)
        node = leaves + step
        parent[a] = parent[b] = node
        members[node] = members[a] + members[b]
        totals[node] = totals[a] + totals[b]
        reached[node] = reached[a] | reached[b]
        size = len(members[node])
        cohesion[node] = (float(totals[node] @ totals[node]) - size) / (size * (size - 1))

    seed, best = None, -1.0
    for node in range(leaves, leaves + len(tree)):
        if reached[node].sum() >= min_reach and cohesion[node] > best:
            seed, best = node, cohesion[node]
    if seed is None:
        return None

    node = seed
    while node in parent and cohesion[parent[node]] >= GENRE_GROWTH * best:
        node = parent[node]
    return members[node]


def _prune_nested(incidence: np.ndarray, cores: list[list[int]],
                  limit: int) -> list[list[int]]:
    """Drop genres that live inside another, until `limit` remain.

    Reducing the count needs an order, and the obvious ones are wrong. By size
    the small genres go first, which loses exactly the distinctive ones —
    dexterity is 124 games. By tightness dexterity also goes, at 0.48 cohesion.
    Neither can tell "small but its own thing" from "small and peripheral".

    Containment can: `Modern Warfare · Vietnam War` is 94% inside the wargame
    genre and adds nothing, while dexterity is only 27% inside anything and is
    the third *least* nested genre of eighteen. So the most-contained genre goes
    first, and dexterity survives down to six.

    Re-measured after every drop, because removing a genre re-attracts its
    signals and changes what everything else contains.
    """
    cores = [list(core) for core in cores]
    while len(cores) > limit:
        loadings = incidence @ _assign_signals(incidence, cores)
        mass = loadings.sum(axis=1, keepdims=True)
        mass[mass == 0] = 1.0
        share = loadings / mass
        member = (share >= 0.5 * share.max(axis=1, keepdims=True)) & (share > 0)

        worst, drop = -1.0, 0
        for i in range(len(cores)):
            here = member[:, i]
            if not here.any():
                worst, drop = 1.0, i     # a genre nobody belongs to goes first
                break
            inside = max((here & member[:, j]).sum() / here.sum()
                         for j in range(len(cores)) if j != i)
            if inside > worst:
                worst, drop = inside, i
        cores.pop(drop)
    return cores


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

    Leftovers move in *groups*, never one signal at a time. A coherent bunch of
    signals that missed out on being its own genre is still a real thing, and
    placing its members independently tears it apart: `Action / Dexterity` and
    `Flicking` went to dice-rolling while `Stacking and Balancing` and
    `Real-time` went to tile-laying, so dexterity as a subject vanished from the
    chart rather than living somewhere findable. The same agglomeration that
    proposes genres decides these groups — take the largest wholly-unplaced
    subtree that still hangs together, and send all of it to one axis.
    """
    n_signals = incidence.shape[1]
    vectors = incidence.T / np.maximum(
        np.linalg.norm(incidence.T, axis=1, keepdims=True), 1e-9
    )
    centroids = np.stack([vectors[core].mean(axis=0) for core in cores])
    centroids /= np.maximum(np.linalg.norm(centroids, axis=1, keepdims=True), 1e-9)
    resemblance = vectors @ centroids.T

    home = np.full(n_signals, -1)
    for axis, core in enumerate(cores):
        home[core] = axis

    # Resemblance *per signal the genre already holds*, not in total. A big genre
    # sits nearer everything simply by having more signals, so scoring in total
    # sends every leftover bloc to whichever genre is already largest — the same
    # base-rate pull that makes one genre swallow the corpus. Dividing by size
    # asks where a bloc fits best rather than where the biggest net is, and it
    # reunites `Real-time` with dexterity instead of filing it under deduction.
    #
    # Going further and taking the *smallest* genre a bloc plausibly fits was
    # tried: it balances better still, but places by size rather than by meaning,
    # and put `Hand Management` — 1634 games — inside a 46-game trick-taking
    # genre. Size corrects the bias; it should not become the criterion.
    held = np.array([float(len(core)) for core in cores])
    for group in _unplaced_groups(vectors, home):
        # One vote for the whole group, so it lands intact.
        pick = int(np.argmax(resemblance[group].sum(axis=0) / held))
        home[group] = pick
        held[pick] += len(group)

    # Which games sit in each genre, judged by its core signals alone.
    in_genre = np.stack([incidence[:, core].sum(axis=1) > 0 for core in cores])

    membership = np.zeros((n_signals, len(cores)))
    for signal in range(n_signals):
        axis = int(home[signal])
        carriers = incidence[:, signal] > 0
        membership[signal, axis] = in_genre[axis][carriers].mean()
    return membership


def _unplaced_groups(vectors: np.ndarray, home: np.ndarray) -> list[list[int]]:
    """The largest coherent bunches among the signals no genre claimed.

    Same rule as genre discovery — maximal subtrees that still hang together —
    applied to what is left over, so a group that narrowly missed becoming an
    axis at least stays together underneath one. A subtree holding any placed
    signal is descended into rather than taken, since those are spoken for.
    """
    n_signals = len(home)
    tree = linkage(vectors, method="ward")
    members = {j: [j] for j in range(n_signals)}
    totals = {j: vectors[j].copy() for j in range(n_signals)}
    cohesion = {j: 1.0 for j in range(n_signals)}
    children: dict[int, tuple[int, int]] = {}
    for step, (a, b, _, _) in enumerate(tree):
        a, b = int(a), int(b)
        node = n_signals + step
        children[node] = (a, b)
        members[node] = members[a] + members[b]
        totals[node] = totals[a] + totals[b]
        size = len(members[node])
        cohesion[node] = (float(totals[node] @ totals[node]) - size) / (size * (size - 1))

    groups, stack = [], [n_signals + len(tree) - 1]
    while stack:
        node = stack.pop()
        free = [j for j in members[node] if home[j] < 0]
        if not free:
            continue                          # every signal here already has a genre
        if node >= n_signals and (len(free) < len(members[node])
                                  or cohesion[node] < GENRE_MIN_COHESION):
            stack.extend(children[node])
            continue
        groups.append(free)
    return groups


def genre_overlap(space: FeatureSpace) -> list[tuple[float, int, int]]:
    """How much each pair of genres describes the same games, worst first.

    Genres are meant to be *different questions* about a game. When two of them
    mark the same population, a game loads on both, its coverage is counted
    twice, and two games that share only that region look further apart on the
    radar than they are. So this is the check to run against any change to axis
    discovery — it is what "are these really different genres?" reduces to.

    Membership is peak-relative, matching `coverage.genre_quality`: a genre
    counts as part of a game when it carries at least half the game's strongest
    loading. Overlap is *containment* — the share of the smaller genre that the
    larger also covers — not Jaccard. Jaccard divides by the union, so a small
    genre sitting wholly inside a huge one scores near zero: dexterity was 57%
    inside a hand-management genre at a Jaccard of 0.016, which is the failure
    that made `GENRE_BASE_RATE` necessary.
    """
    ids = sorted(space.loadings)
    matrix = np.stack([space.loadings[i] for i in ids])
    member = (matrix >= 0.5 * matrix.max(axis=1, keepdims=True)) & (matrix > 0)

    pairs = []
    for i in range(member.shape[1]):
        for j in range(i + 1, member.shape[1]):
            smaller = min(member[:, i].sum(), member[:, j].sum())
            if smaller:
                pairs.append((float((member[:, i] & member[:, j]).sum() / smaller), i, j))
    return sorted(pairs, reverse=True)


def _name_genres(cores: list[list[int]], incidence: np.ndarray,
                 vocab: list[str], member: np.ndarray) -> list[str]:
    """Name every genre, guaranteeing the leading tags are all different.

    The frontend shows only a spoke's leading tag, so two genres led by the same
    one are indistinguishable on the radar and in the legend — and both card
    genres here genuinely lead with `Card Game`. Where that happens the second
    falls through to its next-best tag, so the pair reads `Card Game` and
    `Set Collection` rather than `Card Game` twice in different colours.
    """
    ranked = [_defining_order(core, incidence, vocab, member[:, a])
              for a, core in enumerate(cores)]

    # Strongest claim on a tag wins it; the rest fall through to their next.
    leaders: dict[str, int] = {}
    for a, tags in sorted(enumerate(ranked), key=lambda pair: -pair[1][0][1]):
        for tag, _ in tags:
            if tag not in leaders:
                leaders[tag] = a
                break

    names = []
    for a, tags in enumerate(ranked):
        mine = next((tag for tag, owner in leaders.items() if owner == a), None)
        ordered = ([mine] if mine else []) + [t for t, _ in tags if t != mine]
        names.append(GENRE_NAME_SEPARATOR.join(ordered[:GENRE_TOP_SIGNALS]))
    return names


def _defining_order(core: list[int], incidence: np.ndarray, vocab: list[str],
                    inside: np.ndarray) -> list[tuple[str, float]]:
    """This genre's tags, most *defining* first, with their scores.

    Defining, not merely most-used: a tag earns the name by how much of it lands
    in this genre, so the label says what the genre is rather than which common
    tags happen to appear in it. `Solo / Solitaire Game` is carried by 954 games
    across every kind of game, and naming by frequency alone put it at the head
    of an adventure genre that is really about campaigns and exploration.

    Tempered by reach (`log`), because precision alone crowns whatever is
    rarest: unmoderated it names the wargame genre `Ratio / Combat Results
    Table` and the economic one `Commodity Speculation`, both technically
    perfect and useless as labels.

    Tags may arrive as compounds (`Card Game + Hand Management`), so they are
    split back into the distinct tags they mention — otherwise a card genre
    reads "Card Game · Hand Management · Card Game · Fantasy". BGG also ships
    some tags twice in different cases ("Real-time" and "Real-Time"), so one
    already present in any case is skipped rather than repeated.
    """
    scored = []
    for signal in core:
        carriers = incidence[:, signal] > 0
        reach = carriers.sum()
        if not reach:
            continue
        scored.append(((carriers & inside).sum() / reach * np.log1p(reach), signal))

    out: list[tuple[str, float]] = []
    seen: set[str] = set()
    for score, signal in sorted(scored, reverse=True):
        for tag in vocab[signal].split(GENRE_COMPOUND):
            if tag.casefold() not in seen:
                seen.add(tag.casefold())
                out.append((tag, float(score)))
    return out or [("Other", 0.0)]


def _top_dims(row: np.ndarray, names: list[str], k: int = 3) -> list[tuple[str, float]]:
    """A game's strongest genre dimensions, for display: [(name, loading)]."""
    order = np.argsort(row)[::-1][:k]
    return [(names[j], round(float(row[j]), 2)) for j in order if row[j] > 0.05]


def _zscore(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    std = values.std()
    return (values - values.mean()) / (std if std > 0 else 1.0)
