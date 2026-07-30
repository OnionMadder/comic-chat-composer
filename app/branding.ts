/**
 * mComic '96 brand tokens — the onionized black + neon + Comic Sans identity,
 * as data the app UI and build read from one place.
 *
 * The name is an homage, never a claim: "mComic '96" evokes Microsoft Comic
 * Chat (1996) without using its trademark, and the app carries the
 * not-affiliated line and the MIT art attribution.
 */
export const BRAND = {
  name: "mComic '96",
  /** How the wordmark splits for color: the neon "m", then "Comic", then the year burst. */
  wordmark: { m: 'm', body: 'Comic', year: "'96" },
  tagline: 'Type a conversation. Get a comic.',
  studio: 'Onion Madder',
  notAffiliated: 'Not affiliated with Microsoft. Comic Chat art is Microsoft’s own, MIT-licensed and used with attribution.',
  /** Comic Sans — the font Vincent Connare drew for Comic Chat itself in 1994. */
  fontStack: `"Comic Sans MS", "Comic Sans", "Chalkboard SE", "Comic Neue", cursive`,
} as const;

/** The neon palette, on near-black. Committed single (dark) world. */
export const NEON = {
  void: '#08080B',
  panel: '#101018',
  panel2: '#15151F',
  edge: '#232334',
  ink: '#050507',
  text: '#F2F0FF',
  muted: '#8B87A6',
  cyan: '#2CFFE6', // primary / speech
  pink: '#FF3D9A', // secondary / reply
  violet: '#B57BFF',
  lime: '#B6FF3D', // the '96 burst
  amber: '#FFC61A',
} as const;

/**
 * Stable per-speaker accent, assigned by order of appearance. These are the
 * neon cast colors the member list, row accents, and preview borders share.
 */
export const SPEAKER_COLORS: readonly string[] = [
  NEON.cyan,
  NEON.pink,
  NEON.violet,
  NEON.amber,
  NEON.lime,
  '#5B8CFF', // blue
];

export function speakerColor(index: number): string {
  return SPEAKER_COLORS[((index % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length]!;
}
