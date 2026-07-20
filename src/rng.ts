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
