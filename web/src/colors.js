// One stable colour per mined genre, taken by the genre's position in
// meta.genreDimensions. Keyed by position rather than by name because the
// genres are mined from the data — they change with the corpus and with
// GENRE_AXIS_TARGET, so a name->colour map would silently fall back to grey the
// first time an axis was renamed. Chosen to stay distinguishable in both light
// and dark themes; we only ever paint these as small dots / borders (never as
// text background), so contrast of the label text is never at risk.
export const GENRE_PALETTE = [
  '#d1495b', '#2a7de1', '#6a4c93', '#1b998b', '#e07a5f',
  '#3d7068', '#c99700', '#f4845f', '#4d908e', '#577590',
  '#b5838d', '#e5678a', '#43aa8b', '#9b5de5', '#8d99ae',
  '#7f5539', '#0081a7', '#bc6c25', '#386641', '#8e7dbe',
]

// `genres` is meta.genreDimensions. Unknown or missing genre -> neutral grey.
export const colorFor = (genre, genres = []) => {
  const i = genres.indexOf(genre)
  return i < 0 ? '#8d99ae' : GENRE_PALETTE[i % GENRE_PALETTE.length]
}

// Distinct colours for individual games on the radar, assigned by position in
// the list (stable within a render of the same data). Blues sit at the end so
// early games never blend into the chart's blue base stack.
export const GAME_PALETTE = [
  '#e15759', '#f28e2b', '#59a14f', '#edc948', '#b07aa1',
  '#ff9da7', '#9c755f', '#d37295', '#8cd17d', '#b6992d',
  '#4e79a7', '#76b7b2', '#fabfd2', '#86bcb6', '#79706e',
]

export const gameColor = (index) => GAME_PALETTE[index % GAME_PALETTE.length]
