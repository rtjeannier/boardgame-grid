/**
 * Two verbs get an icon each, and they are the same icon everywhere.
 *
 * Pin holds a game in the collection whatever the selection would rather do.
 * Block takes it out of the running. A filled pin is pinned; a struck circle is
 * blocked. Nothing else in the interface is a verb, so nothing else gets one.
 */

const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.25,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

/**
 * A thumbtack seen from the side, not a map marker.
 *
 * The teardrop this replaces read as a GPS pin — "here is a place" — where the
 * verb means "this stays put". Cap bar, tapering body, flange, needle.
 */
export function Pin({ filled = false, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
         {...stroke} strokeWidth={2}>
      <path d="M8.5 3h7" />
      <path d="M10 3v5.5L7.5 11.5v1h9v-1L14 8.5V3z"
            fill={filled ? 'currentColor' : 'none'} />
      <path d="M12 12.5V21" />
    </svg>
  );
}

export function Block({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" {...stroke}>
      <circle cx="6" cy="6" r="4.4" />
      <path d="M2.9 2.9l6.2 6.2" />
    </svg>
  );
}

export function Close({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" {...stroke}
         strokeWidth={1.4}>
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

export function Search({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" {...stroke}
         strokeWidth={1.3}>
      <circle cx="5" cy="5" r="3.4" />
      <path d="M7.6 7.6l3 3" />
    </svg>
  );
}
