// One stable colour per archetype, keyed by label so it never depends on
// ordering. Chosen to stay distinguishable in both light and dark themes; we
// only ever paint these as small dots / borders (never as text background), so
// contrast of the label text is never at risk.
export const ARCHETYPE_COLORS = {
  'Social Deduction': '#d1495b',
  'Deck Building': '#2a7de1',
  'Worker Placement': '#6a4c93',
  'Engine Building': '#1b998b',
  'Area Control': '#e07a5f',
  'Route Building': '#3d7068',
  'Roll & Write': '#c99700',
  'Dexterity': '#f4845f',
  'Tile Placement': '#4d908e',
  'Drafting': '#577590',
  'Auction': '#b5838d',
  'Push Your Luck': '#e5678a',
  'Cooperative': '#43aa8b',
  'Word / Party': '#9b5de5',
  'Set Collection': '#8d99ae',
}

export const colorFor = (archetype) => ARCHETYPE_COLORS[archetype] || '#8d99ae'

// Distinct colours for individual games on the radar, assigned by position in
// the list (stable within a render of the same data). Blues sit at the end so
// early games never blend into the chart's blue base stack.
export const GAME_PALETTE = [
  '#e15759', '#f28e2b', '#59a14f', '#edc948', '#b07aa1',
  '#ff9da7', '#9c755f', '#d37295', '#8cd17d', '#b6992d',
  '#4e79a7', '#76b7b2', '#fabfd2', '#86bcb6', '#79706e',
]

export const gameColor = (index) => GAME_PALETTE[index % GAME_PALETTE.length]
