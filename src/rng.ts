/**
 * Seeded pseudo-random number generator.
 *
 * The paper is explicit that small-scale randomness is what keeps composed
 * panels from looking machine-generated (§5.2: balloon widths and horizontal
 * positions are chosen randomly; §4.4: the 15% solo-panel roll). Making that
 * randomness seedable is what keeps the composer testable.
 */

/** A function returning a float in [0, 1). */
export type Random = () => number;

/**
 * mulberry32 — small, fast, and good enough for layout jitter.
 *
 * @param seed - Any 32-bit integer. The same seed always yields the same stream.
 */
export function createRandom(seed: number): Random {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [lo, hi]. Returns `lo` when the range is empty or inverted. */
export function randomBetween(rand: Random, lo: number, hi: number): number {
  if (!(hi > lo)) return lo;
  return lo + rand() * (hi - lo);
}

/**
 * A well-distributed index in `[0, count)` derived directly from an integer
 * seed, using the MurmurHash3 finalizer (fmix32).
 *
 * For a one-shot choice keyed by the seed — like which single backdrop a whole
 * conversation uses — this is the right tool, not a PRNG stream. A PRNG's *first*
 * output is strongly correlated across nearby seeds (mulberry32 maps the small
 * sequential seeds people actually type, 1/2/3/…, to a bunched range), so
 * seeding a stream and taking one value clusters the result. fmix32 avalanches
 * fully: adjacent seeds land on unrelated indices, and the spread is uniform.
 */
export function seededIndex(seed: number, count: number): number {
  if (count <= 1) return 0;
  let h = seed >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % count;
}
