"""Embed games in a continuous feature space.

The "genre" of a game isn't one label — a game can be mostly worker-placement
with a dose of engine-building. We recover that structure from the data:

  1. Build a game × signal incidence matrix from BGG mechanic/category names.
  2. Cluster the *signals* by co-occurrence to discover genres, taking every
     cluster the corpus yields — 77 on the live capture (see `_harvest_cores`).
     Axes are therefore named with the actual BGG tags that define them, not
     with whatever a latent factor happened to load on.
  3. Each game's loadings = how its tags divide across those axes, normalised to
     sum to 1 — a genre *split*, not a genre *amount*.
  3b. Those axes are grouped into a dozen named families for the radar to draw
     (see `_spokes`). Nothing is discarded and a family is the plain sum of its
     members, so the chart aggregates the vectors selection scored rather than
     computing anything of its own. Selection itself always sees all 77.
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
purpose. Discovering axes asks "what regions of game-space exist", so tags group
by raw co-occurrence: a tag that is incidental to every game carrying it still
marks out a region. Similarity asks "are these two games substitutes", where only
a game's *core* tags should count, so it weights by centrality instead.

Placing a game on those axes (`_tag_evidence`) is the second kind of question,
not the first, and weights by centrality too — which region a game belongs in
depends on its core tags, not its incidental ones.
"""

from dataclasses import dataclass

import numpy as np
from scipy.cluster.hierarchy import fcluster, leaves_list, linkage
from sklearn.decomposition import PCA

from .params import DEFAULTS, Params
from .model import Game


@dataclass
class FeatureSpace:
    """Genres at two levels: every discovered one, and the families they group into.

    `loadings` is the full set — 77 on the live capture — and is what selection
    and coverage run on. `spokes` sums each family's members and is what the
    radar draws, so the chart aggregates the very vectors the picker scored.
    `spoke_of` maps an axis to its family, which is how the one-kind-per-cell
    rule stays meaningful when the axes are this fine (see `assign.py`).
    """
    vectors: dict[int, np.ndarray]        # game id -> full feature vector
    loadings: dict[int, np.ndarray]       # game id -> genre loadings only (all axes)
    projection: dict[int, tuple[float, float]]  # game id -> global 2-D (x, y)
    top_genres: dict[int, list[tuple[str, float]]]  # id -> [(spoke name, loading)]
    dimension_names: list[str]            # one per radar spoke
    similarity: dict[int, np.ndarray]     # id -> unit-norm FULL-space tag vector
    spokes: dict[int, np.ndarray]         # game id -> per-spoke loadings (summed)
    spoke_of: list[int]                   # axis index -> spoke index
    axis_names: list[str]                 # one per underlying axis


def build_feature_space(games: list[Game],
                        params: Params = DEFAULTS) -> FeatureSpace:
    ids = [g.id for g in games]

    genre = _genre_loadings(games, params)              # (n_games, n_dims), rows normalised
    loadings = genre["loadings"]
    spokes = genre["spokes"]
    dim_names = genre["spoke_names"]

    # Continuous stats, z-scored then scaled down so genre dominates distances.
    weight = _zscore(np.array([g.weight for g in games])) * params.discovery.continuous_scale
    playtime = _zscore(np.log1p([g.playtime for g in games])) * params.discovery.continuous_scale

    matrix = np.column_stack([loadings, weight, playtime])

    # One coherent 2-D map of the whole population for the frontend scatter.
    xy = PCA(n_components=2, random_state=0).fit_transform(matrix)

    top = {
        gid: _top_dims(spokes[i], dim_names, params)
        for i, gid in enumerate(ids)
    }
    return FeatureSpace(
        vectors={gid: matrix[i] for i, gid in enumerate(ids)},
        loadings={gid: loadings[i] for i, gid in enumerate(ids)},
        projection={gid: (round(float(x), 3), round(float(y), 3)) for gid, (x, y) in zip(ids, xy)},
        top_genres=top,
        dimension_names=dim_names,
        similarity=_similarity_space(games),
        spokes={gid: spokes[i] for i, gid in enumerate(ids)},
        spoke_of=genre["spoke_of"],
        axis_names=genre["names"],
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


def _genre_loadings(games: list[Game], params: Params) -> dict:
    """Cluster signals into genres, then split each game across them."""
    vocab, incidence = _signal_space(games, params)

    cores = _harvest_cores(incidence, params.discovery.genre_min_reach, params)
    membership = _assign_signals(incidence, cores, params)

    # How each game's tags divide across the axes, then L1-normalised: every
    # game carries the same *total* genre mass, so the vector says how a game
    # divides itself between genres, not how much genre it has. This has to be
    # L1 because coverage sums across axes. Under L2 the sum of squares is
    # fixed, so total mass grows as sqrt(k) with the number of axes a game
    # touches — 3.16x for a ten-axis sprawl, which exceeds the entire 2.5x range
    # of `coverage.genre_quality`. A bottom-ranked generalist then outscores a #1
    # specialist and rank can never catch up, which is how Brass: Birmingham
    # lost its cell to a pile of eight-axis games.
    # Scaled by how scarce each genre is, so belonging to a rare one counts for
    # more — IDF over genres. Without it a crowded genre wins on sheer volume:
    # a game sitting between the card-game genre and the much smaller train
    # genre was pulled into the card game every time, and only 23% of the games
    # carrying the train genre's own signals were classified as train games.
    # Ticket to Ride Legacy came out a card game.
    #
    # Scarcity is each genre's *core reach* — how many games carry any of its
    # founding signals — which is fixed before this runs, so the weighting does
    # not depend on the assignment it is producing.
    #
    # Note this also lifts what a scarce genre is worth to `coverage`, not just
    # which genre a game counts as. That is intended and is why picks spread
    # more evenly, but it is the broader half of the effect.
    reach = np.array([(incidence[:, core].sum(axis=1) > 0).sum() for core in cores])
    loadings = _tag_evidence(vocab, incidence, membership, params) \
        * np.maximum(reach, 1.0) ** -params.discovery.genre_scarcity
    mass = loadings.sum(axis=1, keepdims=True)
    # Only a game carrying no signals at all can be zero here — every signal
    # belongs to exactly one axis (see `_assign_signals`). Such a game covers
    # no genre at all and is never picked, which is the honest reading of "we
    # know nothing about this one".
    mass[mass == 0] = 1.0
    shares = loadings / mass

    # Named last: a genre's label depends on which games ended up in it, so the
    # loadings have to exist first (see `_name_genres`).
    member = ((shares >= params.selection.genre_floor
               * shares.max(axis=1, keepdims=True)) & (shares > 0))
    names = _name_genres(cores, incidence, vocab, member, params)

    # The radar reads these axes through a smaller set of named families. A
    # spoke's loading is the plain sum of its members', so what is drawn is an
    # aggregation of the vectors the picker scored, not a second calculation.
    groups = _spokes(incidence, cores, params.discovery.genre_spokes)
    spokes = np.stack([shares[:, group].sum(axis=1) for group in groups], axis=1)
    spoke_member = ((spokes >= params.selection.genre_floor
                     * spokes.max(axis=1, keepdims=True)) & (spokes > 0))
    spoke_names = _name_genres([[j for i in group for j in cores[i]] for group in groups],
                               incidence, vocab, spoke_member, params)

    return {"loadings": shares, "names": names, "spokes": spokes,
            "spoke_names": spoke_names,
            "spoke_of": [next(g for g, group in enumerate(groups) if i in group)
                         for i in range(len(cores))]}


def _tag_evidence(vocab: list[str], incidence: np.ndarray,
                  membership: np.ndarray, params: Params) -> np.ndarray:
    """(n_games x n_genres) — each game's tags, counted once each, per genre.

    Every *tag* a game carries is one unit of evidence about what that game is.
    The unit is scaled by how core the tag is to this particular game, then split
    evenly across the signals present that mention it, and each share lands on
    that signal's genre.

    Two things this fixes, neither needing a tuned constant:

    Double counting. `_signal_space` keeps base tags *and* their pairwise
    compounds, so three base tags produce six features while four ordinary tags
    produce four. Ticket to Ride Legacy carries seven train-ish tags and three
    card-ish ones and came out a card game, because the card tags were base tags
    and brought three compounds with them. Splitting a tag's unit across the
    signals carrying it makes `Hand Management` worth the same whether it appears
    alone or in three compounds. Note the split preserves what the compound
    *says*: discovery may file `Hand Management + Set Collection` under a
    different genre than `Hand Management` alone, and that routing still lands.

    Soft tags. Weighted by `_tag_centrality`, a tag that sits badly with the
    game's other tags barely counts. BGG tags Lords of Waterdeep `Hidden Roles`
    for its secret Lord cards, the same tag Secret Hitler carries for social
    deduction; centrality reads 0.020 there against 0.229 here, and Lords of
    Waterdeep stops being a bluffing game.

    (`_tag_centrality` is why this is a loop and not a matrix product: the split
    denominator is per game, since it counts only the signals that game has.)
    """
    centrality = incidence * _tag_centrality(incidence)
    home = membership.argmax(axis=1)         # each signal belongs to at most one genre
    strength = membership.max(axis=1)        # ...with this diagnostic weight
    # Signals that beat no genre by enough were dropped (see `_assign_signals`)
    # and are not evidence about anything. They have to be excluded here rather
    # than left to contribute zero, because a tag's unit is split across the
    # signals carrying it and a dropped signal would still take a share.
    alive = strength > 0

    # Which signals mention each tag. A compound's name is its two tags joined by
    # GENRE_COMPOUND (see `_signal_space`), so the vocabulary already says this.
    mentions: dict[str, list[int]] = {}
    for signal, name in enumerate(vocab):
        for tag in name.split(params.presentation.genre_compound):
            mentions.setdefault(tag, []).append(signal)

    evidence = np.zeros((incidence.shape[0], membership.shape[1]))
    for game in range(incidence.shape[0]):
        present = set(np.flatnonzero((incidence[game] > 0) & alive))
        tags = {tag for signal in present for tag in vocab[signal].split(params.presentation.genre_compound)}
        for tag in tags:
            carriers = [s for s in mentions[tag] if s in present]
            for signal in carriers:
                evidence[game, home[signal]] += (
                    strength[signal] * centrality[game, signal] / len(carriers))
    return evidence


def _signal_space(games: list[Game], params: Params) -> tuple[list[str], np.ndarray]:
    """Game x signal incidence, plus a compound for each pair of base-rate tags.

    A tag carried by more of the corpus than one genre's even share cannot
    itself be a genre — `Hand Management` marks 1634 of 5000 games and `Card
    Game` 1483, and left to found genres they anchor one covering most of
    everything. Each pair of such tags therefore also becomes a signal in its
    own right: `Card Game + Hand Management`, `Tile Placement + Open Drafting`.
    A compound is specific enough to name a kind of game where neither half was,
    and several genres exist only because of them.

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
    — is the wrong one *here*. All thirteen come out 85-99% covered, which would
    say drop them all. It measures whether each *game* keeps some signal, not
    whether the *relationships between games* survive. (`_spanning` does use it,
    for a different question: whether a tag that is going to lose its bare form
    anyway would strand its games. There it separates 95% from 0%.)

    A tag that *spans* kinds rather than naming one is the exception to keeping
    parents — see `_spanning`. Worker placement divides into card, economic and
    area-control games the way `Card Game` divides, and keeping its bare tag
    gathers all of them into a single axis instead.

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
    base = [j for j in range(len(vocab)) if carried[j] > len(games) * params.discovery.genre_base_rate]
    floor = len(games) / params.discovery.genre_min_reach / params.discovery.genre_reach_divisor

    # Tags that span several kinds of game are paired like base tags but do not
    # appear on their own, so a game is a *type* of one rather than merely
    # carrying it (see `_spanning`).
    spanning = _spanning(vocab, incidence, carried, base, floor, params)
    base = sorted(base + list(spanning))

    names = [s for j, s in enumerate(vocab) if j not in spanning]
    columns = [incidence[:, j] for j in range(len(vocab)) if j not in spanning]
    paired = set()
    for a, first in enumerate(base):
        for second in base[a + 1:]:
            both = incidence[:, first] * incidence[:, second]
            if both.sum() >= floor:
                names.append(f"{vocab[first]}{params.presentation.genre_compound}{vocab[second]}")
                columns.append(both)
                paired.add((first, second))

    for first, second in _interactions(games, incidence, carried, floor, params):
        if (first, second) not in paired:
            names.append(f"{vocab[first]}{params.presentation.genre_compound}{vocab[second]}")
            columns.append(incidence[:, first] * incidence[:, second])
    return names, np.stack(columns, axis=1)


def _spanning(vocab: list[str], incidence: np.ndarray, carried: np.ndarray,
              base: list[int], floor: float, params: Params) -> set[int]:
    """Tags to represent only through their compounds, never on their own.

    `Worker Placement` is not one thing. There are worker-placement card games,
    economic ones and area-control ones, exactly as `Card Game` divides into
    `Card Game + Hand Management` and the rest — but with a single bare signal
    they were indistinguishable, so every worker-placement game got the same
    nudge whatever kind it was.

    A tag qualifies on three counts, and all three are needed.

    It has to *span*. Measure how alike a tag's games are, then measure again
    with the tag deleted from every vector: if what is left barely holds
    together, the tag was the only thing they shared. Worker Placement keeps
    0.60, inside the 0.49-0.70 band the base tags occupy, where a tag that names
    a kind outright keeps far more — `World War II` 0.92, `Miniatures` 0.86.

    It must anchor no genre. `Deduction` and `Party Game` also span, but they
    found genres, and taking their bare tag away concentrates them rather than
    spreading them (6.2 -> 4.0 and 4.7 -> 3.2 effective genres). So discovery
    runs once first, on the signal space as it would be without any of this.

    Its compounds must cover its games, or dropping the bare tag deletes the
    concept instead of dividing it. `Action / Dexterity` passes the first two
    tests and fails here outright: not one of its pairings with a base tag
    reaches `floor`, so coverage is 0%. Crokinole carries three tags — `Action /
    Dexterity`, `Flicking`, `Team-Based Game` — and none is a base tag, because
    dexterity games do not share the euro vocabulary base tags are drawn from.
    The span measure flags dexterity for the opposite reason to worker
    placement: its games share nothing else because the tag *is* their kind.
    Worker Placement covers 95% across twelve compounds.

    (`_signal_space` documents coverage as the wrong check. That is about
    whether to drop base tags' parents, where all thirteen score 85-99% and it
    cannot discriminate. Here it separates 95% from 0%.)
    """
    weighted = incidence * _tag_centrality(incidence)

    def cohesion(rows: np.ndarray, without: int | None = None) -> float:
        """How alike these games are, optionally with one tag struck out."""
        vectors = weighted[rows]
        if without is not None:
            vectors = vectors.copy()
            vectors[:, without] = 0.0
        size = len(vectors)
        if size < 2:
            return 0.0
        units = vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)
        total = units.sum(axis=0)
        return (float(total @ total) - size) / (size * (size - 1))

    # Which tags already head a genre, judged on the space as it stands. Only
    # the plain columns matter here, so the compounds are left out of the pass,
    # and the clusters are grouped to the radar's own granularity before asking
    # — every tag leads *some* cluster once discovery runs to exhaustion, so the
    # question is only meaningful about families a reader would see.
    plain = np.stack([incidence[:, j] for j in range(len(vocab))], axis=1)
    clusters = _harvest_cores(plain, params.discovery.genre_min_reach, params)
    anchors = set()
    for group in _spokes(plain, clusters, params.discovery.genre_spokes):
        held = [j for c in group for j in clusters[c]]
        anchors.add(max(held, key=lambda j: plain[:, j].sum()))

    found = set()
    for tag in range(len(vocab)):
        if tag in base or tag in anchors or carried[tag] < floor * 2:
            continue
        mine = np.flatnonzero(incidence[:, tag] > 0)
        held = cohesion(mine)
        if not held or cohesion(mine, without=tag) > params.discovery.genre_spans * held:
            continue
        covered = np.zeros(len(mine), dtype=bool)
        for other in base:
            if (incidence[:, tag] * incidence[:, other]).sum() >= floor:
                covered |= incidence[mine, other] > 0
        if covered.mean() >= params.discovery.spanning_coverage:
            found.add(tag)
    return found


# A spanning tag's compounds have to account for very nearly all of its games,
# since dropping the bare tag leaves them with nothing else. This separates
# `Worker Placement` at 95% from `Action / Dexterity` at 0%, so it is a
# well-definedness guard rather than a dial — the nearest other candidates score
# 81% and 57% and are already excluded for anchoring genres. It lives in
# `config.py` as SPANNING_COVERAGE all the same: a guard is still a magnitude.


def _interactions(games: list[Game], incidence: np.ndarray,
                  carried: np.ndarray, floor: float,
                  params: Params) -> list[tuple[int, int]]:
    """Tag pairs that mean more together than either tag means alone.

    The base-rate rule above answers "is this tag too broad to be a genre", and
    pairs those tags to split them. This answers the opposite question — is a
    specific kind of game hiding inside two ordinary tags, where neither tag
    names it. `Auction / Bidding` is a grab bag and so is `Network and Route
    Building`, but together they are the 18xx family.

    Measured as how much tighter the pair's games are than the better parent's,
    using the same mean-pairwise-cosine cohesion that genre discovery runs on,
    over `_similarity_space` vectors so a game's core tags decide it. A pair has
    to clear `GENRE_INTERACTION` and the same shared-game floor as any compound.

    Tags carried by fewer than twice the shared-game floor are not considered.
    Cohesion over a handful of games is mostly noise, and two tags that small
    could not clear the floor between them anyway.
    """
    vectors = _similarity_space(games)
    matrix = np.stack([vectors[g.id] for g in games])

    def cohesion(rows: np.ndarray) -> float:
        """Mean pairwise cosine among these games; O(1) from the vector sum."""
        size = len(rows)
        if size < 2:
            return 0.0
        total = matrix[rows].sum(axis=0)
        return (float(total @ total) - size) / (size * (size - 1))

    usable = [j for j in range(incidence.shape[1]) if carried[j] >= floor * 2]
    alone = {j: cohesion(np.flatnonzero(incidence[:, j] > 0)) for j in usable}

    found = []
    for first in usable:
        here = np.flatnonzero(incidence[:, first] > 0)
        shared = incidence[here].sum(axis=0)
        sums = incidence[here].T @ matrix[here]    # every partner at once
        for second in usable:
            if second <= first or shared[second] < floor:
                continue
            size = int(shared[second])
            together = (float(sums[second] @ sums[second]) - size) / (size * (size - 1))
            parent = max(alone[first], alone[second])
            if parent > 0 and together >= params.discovery.genre_interaction * parent:
                found.append((first, second))
    return found


def _harvest_cores(incidence: np.ndarray, target: int,
                   params: Params) -> list[list[int]]:
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

    The search runs until the pool empties — 77 clusters on the live capture —
    and every one of them becomes an axis. Truncating it and pruning the
    remainder threw away 65 of the 77: wargame was left split across five
    clusters that never recombined while `Racing` and `Sports` were attracted
    into it, and dice, dexterity, racing, roll-and-write, trick-taking, auction
    and party were never discovered at all. The radar reads the 77 through the
    named parents `_spokes` groups them into.

    What is left unclaimed goes to `_assign_signals`, which attaches it in
    coherent blocs rather than tag by tag.
    """
    n_games, n_signals = incidence.shape
    min_reach = n_games / target / params.discovery.genre_reach_divisor

    claimed: list[list[int]] = []
    pool = list(range(n_signals))
    while len(pool) > 1:
        found = _tightest(incidence[:, pool], min_reach, params)
        if found is None:
            break
        claimed.append([pool[i] for i in found])
        taken = set(claimed[-1])
        pool = [j for j in pool if j not in taken]
    return claimed


def _tightest(subset: np.ndarray, min_reach: float,
              params: Params) -> list[int] | None:
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
    while node in parent and cohesion[parent[node]] >= params.discovery.genre_growth * best:
        node = parent[node]
    return members[node]


def _spokes(incidence: np.ndarray, cores: list[list[int]],
            limit: int) -> list[list[int]]:
    """Group the genres into `limit` families, for the radar to show.

    Returns a list of index lists *into `cores`*. Every genre lands in exactly
    one family and none is discarded — the algorithm keeps working on all of
    them, and a family's loading is the plain sum of its members', so the radar
    aggregates what the picker saw rather than recomputing it.

    Genres are grouped by the **games** they describe, not by their signals. Two
    genres are the same family if they cover the same shelf. Grouping on signals
    instead chains: the big clusters bridge everything and one family ends up
    holding 96% of the corpus. Ward keeps the merges balanced where average and
    complete linkage both collapse.

    What this recovers is the fragmentation that truncated discovery caused.
    Wargame is five clusters — `Wargame · Hexagon Grid · Simulation`,
    `Campaign / Battle Card Driven`, `Civil War`, `Age of Reason`, `Modern
    Warfare` — and they reunite here. `Dice` gathers dice with racing, and
    `Network and Route Building` assembles the 18xx family out of trains,
    auctions and stock holding.

    Ward has to place everything, so the least related clusters end up together:
    one family collects `Nautical`, `Trivia`, `Print & Play`, `Mancala` and a
    dozen more, and its name is whichever of them leads. That is cosmetic —
    underneath they are still separate axes, so selection is unaffected.
    """
    reach = np.stack([incidence[:, core].sum(axis=1) for core in cores])
    reach /= np.maximum(np.linalg.norm(reach, axis=1, keepdims=True), 1e-9)
    if len(cores) <= limit:
        return [[i] for i in range(len(cores))]
    labels = fcluster(linkage(reach, method="ward"), limit, criterion="maxclust")
    return [[i for i in range(len(cores)) if labels[i] == g] for g in sorted(set(labels))]


def spoke_families(spokes: np.ndarray, size: int = 2) -> list[int]:
    """Group the radar spokes into colour families: spoke index -> family index.

    Presentation only. Selection never sees this — it exists because twelve
    colours cannot be told apart, and grouping them into families of two lets
    hue carry the family while lightness separates the pair. Measured on the
    live capture: six families at two lightnesses hold a worst-case separation
    of ΔE 22.7, against 19.5 for twelve free hues and **8.5** for the palette
    this replaces, where `Deduction · Party Game` and `Dice · Dice Rolling` were
    the same colour on a ten-pixel dot.

    Families come from the dendrogram's *order*, not from cutting it. Cutting
    was tried first, being the obvious thing, and does not work here:

    - There is no natural number of families to find. Merge heights climb almost
      flat from eleven clusters down to four — 1.163, 1.168, 1.225, 1.243,
      1.288, 1.294, 1.327 — so any cut is arbitrary.
    - The cut that six gives is badly unbalanced, and immovably so. `Economic`,
      `Card Game` and `Area Majority` merge into one family holding 39.6% of the
      corpus, and they stay together at every cut from five families to eight,
      while `Network and Route Building` sits alone at 3.9%.

    Ward's leaf ordering places similar spokes adjacent, so walking it in pairs
    keeps the grouping data-derived while forcing the balance colour needs:
    10.1% to 22.4% per family on the live capture, every family the same size,
    and it works unchanged on a corpus whose spokes are entirely different.

    Two honest caveats. Adjacency in the ordering is weaker than kinship — the
    pairs at the tail are "next to each other" rather than "the same kind of
    game", which is the same concession `_spokes` makes about Ward having to
    place everything. And families are not stable across corpora: the seed and
    the live capture share almost no spoke names, let alone pairings. That is
    inherent, since the axes follow the corpus, and it is why the palette is
    generated from whatever the contract carries rather than written down.
    """
    reach = spokes.T.astype(float).copy()
    reach /= np.maximum(np.linalg.norm(reach, axis=1, keepdims=True), 1e-9)
    n = reach.shape[0]
    if n <= size:
        return [0] * n
    order = leaves_list(linkage(reach, method="ward"))
    family = [0] * n
    for position, spoke in enumerate(order):
        family[int(spoke)] = position // size
    return family


def _assign_signals(incidence: np.ndarray, cores: list[list[int]],
                    params: Params) -> np.ndarray:
    """(n_signals x n_axes) map placing each signal on at most one axis.

    The harvested cores define the genres; every signal left over joins the core
    it most resembles, or none. Without any attraction the axes only span the
    cores — 32 of 274 signals — and 633 games carry no signal on any axis. Those
    games are not merely unplaced — with no genre at all they can never be
    picked, whatever they are. Attraction drops that from 633 games to 3.

    A signal joins one axis but does not count fully towards it. Its weight is
    how *diagnostic* it is: of the games carrying this signal, the share that
    really sit in that genre. Cross-cutting signals therefore barely register
    while defining ones count outright — `Team-Based Game` spans 356 games and
    scores 0.15 on the traitor-game axis, `Flicking` spans 30 and scores 0.93 on
    dexterity. Core signals score exactly 1.0 and need no special case: every
    game carrying a core signal is in that core by definition.

    That share is only meaningful against how big the genre is, so a signal that
    does not beat chance by `GENRE_MIN_LIFT` is re-homed where it does, and
    dropped only if nowhere will have it. A tag forced into a genre it merely
    overlaps by coincidence goes on to donate that genre to every game carrying
    it, and the games it misleads about are exactly the ones with nothing else
    in common with it — `Race` and `Track Movement` sat in the card genre at
    lifts of 1.24 and 1.02, which is how Magical Athlete, a game with no cards,
    came out a card game.

    Do not collapse the two steps by placing on lift in the first place. Lift
    divides by genre size, so it always prefers the smallest genre a signal
    plausibly touches: placing that way sends 65 signals into the economic genre
    and doubles the word-game genre, dropping their labels' accuracy to 79% and
    41%. Resemblance decides where a signal goes; lift only decides whether that
    was tenable.

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
    for group in _unplaced_groups(vectors, home, params):
        # One vote for the whole group, so it lands intact.
        pick = int(np.argmax(resemblance[group].sum(axis=0) / held))
        home[group] = pick
        held[pick] += len(group)

    # Which games sit in each genre, judged by its core signals alone.
    in_genre = np.stack([incidence[:, core].sum(axis=1) > 0 for core in cores])
    chance = in_genre.mean(axis=1)      # what a random signal would score here
    founding = {signal for core in cores for signal in core}

    # Share of each signal's games sitting in each genre — every pair at once,
    # because a signal that fits its assigned genre badly needs somewhere to
    # look. Lift is that share against what a random signal would score.
    carried = (incidence > 0).astype(float)
    shares = (in_genre.astype(float) @ carried) / np.maximum(carried.sum(axis=0), 1.0)
    lift = shares / np.maximum(chance[:, None], 1e-9)

    membership = np.zeros((n_signals, len(cores)))
    for signal in range(n_signals):
        axis = int(home[signal])
        # Beat chance by GENRE_MIN_LIFT or belong nowhere. The share alone says
        # nothing when the genre is huge: the two largest cover 45% and 55% of
        # the corpus, so a tag scores about half with them by coincidence.
        # Founding signals are exempt — a genre keeps what defines it.
        if signal not in founding and lift[axis, signal] < params.discovery.genre_min_lift:
            # Resemblance put it somewhere it has no business being. Dropping it
            # here would throw away a signal that fits elsewhere perfectly well,
            # so ask where it actually belongs before giving up on it. Placement
            # and this test are different questions — geometric closeness to a
            # centroid against "do these games really land there" — and 56
            # signals fail the first while passing the second, `Income` into the
            # wargame genre at a lift of 0.40 when economic games want it at
            # 4.30. Blocs still move together (see `_unplaced_groups`); this
            # only re-homes what would otherwise leave the bloc entirely.
            axis = int(np.argmax(lift[:, signal]))
            # Re-home readily, drop reluctantly. A signal is only worthless if
            # it beats chance *nowhere*, which is a lower bar than the one that
            # decides a home is untenable. Holding both to GENRE_MIN_LIFT threw
            # away `Dice` — 423 games, best lift 1.07 — leaving roll-and-writes
            # with no signal for what they are, so That's Pretty Clever!, Trek
            # 12 and Monza came out wargames on the strength of `Dice Rolling +
            # Solo / Solitaire Game`, which is really about solo wargames.
            if lift[axis, signal] < 1.0:
                continue                # fits nowhere: genuinely not evidence
        membership[signal, axis] = shares[axis, signal]
    return membership


def _unplaced_groups(vectors: np.ndarray, home: np.ndarray,
                     params: Params) -> list[list[int]]:
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
                                  or cohesion[node] < params.discovery.genre_min_cohesion):
            stack.extend(children[node])
            continue
        groups.append(free)
    return groups


def genre_overlap(space: FeatureSpace,
                  params: Params = DEFAULTS) -> list[tuple[float, int, int]]:
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

    Measured over the radar spokes, since those are the genres a reader sees and
    has to tell apart. The axes underneath are meant to overlap — several of
    them make up one spoke.
    """
    ids = sorted(space.spokes)
    matrix = np.stack([space.spokes[i] for i in ids])
    member = ((matrix >= params.selection.genre_floor
               * matrix.max(axis=1, keepdims=True)) & (matrix > 0))

    pairs = []
    for i in range(member.shape[1]):
        for j in range(i + 1, member.shape[1]):
            smaller = min(member[:, i].sum(), member[:, j].sum())
            if smaller:
                pairs.append((float((member[:, i] & member[:, j]).sum() / smaller), i, j))
    return sorted(pairs, reverse=True)


def _name_genres(cores: list[list[int]], incidence: np.ndarray,
                 vocab: list[str], member: np.ndarray,
                 params: Params) -> list[str]:
    """Name every genre, guaranteeing the leading tags are all different.

    The frontend shows only a spoke's leading tag, so two genres led by the same
    one are indistinguishable on the radar and in the legend — and both card
    genres here genuinely lead with `Card Game`. Where that happens the second
    falls through to its next-best tag, so the pair reads `Card Game` and
    `Set Collection` rather than `Card Game` twice in different colours.
    """
    ranked = [_defining_order(core, incidence, vocab, member[:, a], params)
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
        names.append(params.presentation.genre_name_separator.join(
            ordered[:params.presentation.genre_top_signals]))
    return names


def _defining_order(core: list[int], incidence: np.ndarray, vocab: list[str],
                    inside: np.ndarray, params: Params) -> list[tuple[str, float]]:
    """This genre's tags, most *defining* first, with their scores.

    Defining, not merely most-used: a tag earns the name by how much of it lands
    in this genre, so the label says what the genre is rather than which common
    tags happen to appear in it. `Solo / Solitaire Game` is carried by 954 games
    across every kind of game, and naming by frequency alone put it at the head
    of an adventure genre that is really about campaigns and exploration.

    Balanced against how much of the genre the tag *describes*, because
    precision alone crowns whatever is rarest: unmoderated it names the wargame
    genre `Ratio / Combat Results Table` and the economic one `Commodity
    Speculation`, both technically perfect and useless as labels.

    Both halves are needed, and the score is their harmonic mean, so a tag has
    to be about this genre *and* about most of its members. This was precision
    tempered by `log(reach)`, which is a proxy for the second half and too weak
    a one: `Voting` named the party genre while describing 21% of it, and
    `Stacking and Balancing` named dexterity at 21%, each winning on being
    almost exclusive to a genre it barely covers. Naming by description alone
    fails the other way, which is what the precision half is for.

    Tags may arrive as compounds (`Card Game + Hand Management`), so they are
    split back into the distinct tags they mention — otherwise a card genre
    reads "Card Game · Hand Management · Card Game · Fantasy". BGG also ships
    some tags twice in different cases ("Real-time" and "Real-Time"), so one
    already present in any case is skipped rather than repeated.
    """
    scored = []
    members = max(int(inside.sum()), 1)
    for signal in core:
        carriers = incidence[:, signal] > 0
        reach = carriers.sum()
        if not reach:
            continue
        held = (carriers & inside).sum()
        precision = held / reach          # how much of the tag is this genre
        recall = held / members           # how much of the genre is this tag
        if not held:
            continue
        scored.append((2 * precision * recall / (precision + recall), signal))

    out: list[tuple[str, float]] = []
    seen: set[str] = set()
    for score, signal in sorted(scored, reverse=True):
        for tag in vocab[signal].split(params.presentation.genre_compound):
            if tag.casefold() not in seen:
                seen.add(tag.casefold())
                out.append((tag, float(score)))
    return out or [("Other", 0.0)]


def _top_dims(row: np.ndarray, names: list[str],
              params: Params = DEFAULTS) -> list[tuple[str, float]]:
    """A game's strongest genre dimensions, for display: [(name, loading)]."""
    order = np.argsort(row)[::-1][:params.presentation.genres_shown_per_game]
    return [(names[j], round(float(row[j]), 2))
            for j in order if row[j] > params.presentation.min_loading_shown]


def _zscore(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    std = values.std()
    return (values - values.mean()) / (std if std > 0 else 1.0)
