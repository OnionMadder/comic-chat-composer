/**
 * Character position and orientation (§4.3).
 *
 * Characters are laid out along a single horizontal row. The composer chooses
 * an ordering and a facing for each character by greedily minimising a scoring
 * function over ordered pairs:
 *
 *     Σ over (a,b), a≠b:  Facing(a,b)  +  Neighbors(a, Left(a), Right(a))
 *
 * The dominant term is a heavy penalty (40 by default) for a speaker who is
 * *not* facing the character they addressed. Everything else is single digits,
 * so in practice "face the person you are talking to" wins, and the remaining
 * weights break ties.
 */

import type { Facing, FacingPenalties } from './types.ts';

export interface Placement {
  author: string;
  /** Horizontal centre of the character's face. */
  x: number;
  facing: Facing;
}

/** True when `a`, given its facing, is turned toward `b`'s position. */
function isFacing(a: Placement, b: Placement): boolean {
  return a.facing === 'right' ? b.x > a.x : b.x < a.x;
}

/** How many placed characters stand strictly between `a` and `b`. */
function countBetween(all: Placement[], a: Placement, b: Placement): number {
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  let n = 0;
  for (const c of all) {
    if (c === a || c === b) continue;
    if (c.x > lo && c.x < hi) n++;
  }
  return n;
}

/**
 * The `Facing(a, b)` term: what it costs for `a` to stand and face as it does,
 * relative to `b`.
 */
function scorePair(
  a: Placement,
  b: Placement,
  addresseesOf: ReadonlyMap<string, readonly string[]>,
  between: number,
  w: FacingPenalties,
): number {
  const addressed = addresseesOf.get(a.author) ?? [];
  const aAddressedB = addressed.includes(b.author);
  const aFacesB = isFacing(a, b);
  const bFacesA = isFacing(b, a);

  let s = 0;
  if (!aAddressedB) {
    if (!aFacesB) s += w.notAddrNotFacing;
    if (!bFacesA) s += w.notAddrOtherNotFacing;
  } else {
    if (!bFacesA) s += w.addrOtherNotFacing;
    if (!aFacesB) s += w.addrNotFacing;
    s += w.addrBetweenFactor * between;
  }
  return s;
}

/** Total pairwise score for a complete configuration. */
function scoreConfiguration(
  config: readonly Placement[],
  addresseesOf: ReadonlyMap<string, readonly string[]>,
  w: FacingPenalties,
): number {
  let total = 0;
  for (const a of config) {
    for (const b of config) {
      if (a === b) continue;
      total += scorePair(a, b, addresseesOf, countBetween(config as Placement[], a, b), w);
    }
  }
  return total;
}

/** The `Neighbors` term: one point per character that moved since last panel. */
function neighborPenalty(
  config: readonly Placement[],
  previousPositions: ReadonlyMap<string, number>,
  w: FacingPenalties,
): number {
  let total = 0;
  for (const p of config) {
    const prev = previousPositions.get(p.author);
    if (prev !== undefined && Math.abs(prev - p.x) > 1e-6) total += w.neighborChange;
  }
  return total;
}

export interface PlaceCharactersOptions {
  /** Participants to place, in the order they entered the panel. */
  authors: readonly string[];
  /** Who each author addressed in this panel. */
  addresseesOf: ReadonlyMap<string, readonly string[]>;
  /** Where each author stood in the previous panel, if they were in it. */
  previousPositions: ReadonlyMap<string, number>;
  panelWidth: number;
  penalties: FacingPenalties;
}

/**
 * Place characters along the panel's horizontal axis and choose their facings.
 *
 * Slots are evenly spaced across the panel width. The solver is the paper's
 * greedy one — place character 1 (1 slot × 2 facings), then character 2
 * (2 slots × 2 facings), and so on, keeping the lowest-scoring option at each
 * step — followed by a local search.
 *
 * The local search is a deliberate addition, not in the paper, which
 * acknowledges its greedy pass "does an adequate job" without claiming
 * optimality. Two things go wrong without it:
 *
 *  - Greedy fixes the first character's facing before any sibling exists to
 *    score against. That arbitrary choice can pin the panel into a layout
 *    where a speaker faces away from the character they addressed — the single
 *    worst outcome the scoring function exists to prevent.
 *  - Greedy seats characters in arrival order, so a bystander can end up
 *    standing between a speaker and their addressee. That is exactly what the
 *    `addrBetweenFactor` term penalises, but greedy cannot undo it once the
 *    bystander is placed.
 *
 * Accepting any facing flip or position swap that strictly improves the total
 * fixes both, and for casts at or below {@link EXHAUSTIVE_MAX} an exhaustive
 * pass over every seating and facing then guarantees the true optimum. Since
 * the paper caps a panel at five characters, that exhaustive path is the one
 * real panels take; the greedy result is kept for larger casts, where the
 * factorial search would be too expensive.
 *
 * Ties always keep the incumbent, so the greedy pass's arrival-order seating
 * and the previous panel's positions both survive as tie-breakers — which is
 * what keeps characters from shuffling between panels for no reason.
 *
 * @returns One {@link Placement} per author, in the order given.
 */
export function placeCharacters(options: PlaceCharactersOptions): Placement[] {
  const { authors, addresseesOf, previousPositions, panelWidth, penalties } = options;
  const n = authors.length;
  if (n === 0) return [];

  const slots = Array.from({ length: n }, (_, i) => ((i + 1) * panelWidth) / (n + 1));

  const placed: Placement[] = [];
  for (const author of authors) {
    const used = new Set(placed.map((p) => p.x));
    let best: Placement | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const x of slots) {
      if (used.has(x)) continue;
      for (const facing of ['left', 'right'] as const) {
        const trial: Placement = { author, x, facing };
        const config = [...placed, trial];
        const score =
          scoreConfiguration(config, addresseesOf, penalties) +
          neighborPenalty(config, previousPositions, penalties);
        if (score < bestScore) {
          bestScore = score;
          best = trial;
        }
      }
    }

    // `best` is always assigned: there are n slots, at most n-1 are used.
    placed.push(best!);
  }

  const totalScore = (config: readonly Placement[]): number =>
    scoreConfiguration(config, addresseesOf, penalties) +
    neighborPenalty(config, previousPositions, penalties);

  let improved = true;
  while (improved) {
    improved = false;
    let current = totalScore(placed);

    // Move 1: flip one character's facing.
    for (let i = 0; i < placed.length; i++) {
      const candidate = placed.slice();
      const p = placed[i]!;
      candidate[i] = { ...p, facing: p.facing === 'left' ? 'right' : 'left' };
      const after = totalScore(candidate);
      if (after < current) {
        placed[i] = candidate[i]!;
        current = after;
        improved = true;
      }
    }

    // Move 2: swap two characters' positions, keeping their facings.
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const candidate = placed.slice();
        candidate[i] = { ...a, x: b.x };
        candidate[j] = { ...b, x: a.x };
        const after = totalScore(candidate);
        if (after < current) {
          placed[i] = candidate[i]!;
          placed[j] = candidate[j]!;
          current = after;
          improved = true;
        }
      }
    }
  }

  if (n <= EXHAUSTIVE_MAX) {
    const exact = exhaustiveBest(placed, slots, totalScore);
    if (exact) return exact;
  }

  return placed;
}

/**
 * Largest cast for which every seating and facing is enumerated. The paper caps
 * a panel at five characters, so this covers every panel in practice while
 * keeping the factorial cost bounded (5! × 2^5 = 3840 configurations).
 */
const EXHAUSTIVE_MAX = 5;

/**
 * Enumerate every seating and facing, returning the first strictly better
 * configuration found, or `null` if the incumbent is already optimal.
 */
function exhaustiveBest(
  incumbent: readonly Placement[],
  slots: readonly number[],
  totalScore: (config: readonly Placement[]) => number,
): Placement[] | null {
  const n = incumbent.length;
  let best: Placement[] | null = null;
  let bestScore = totalScore(incumbent);

  const authors = incumbent.map((p) => p.author);
  const seating: string[] = [];
  const used = new Array<boolean>(n).fill(false);

  const recurse = (): void => {
    if (seating.length === n) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const config: Placement[] = seating.map((author, i) => ({
          author,
          x: slots[i]!,
          facing: mask & (1 << i) ? 'right' : 'left',
        }));
        const score = totalScore(config);
        if (score < bestScore) {
          bestScore = score;
          best = config;
        }
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      seating.push(authors[i]!);
      recurse();
      seating.pop();
      used[i] = false;
    }
  };
  recurse();

  if (!best) return null;
  // Return placements in the caller's author order, not seating order.
  const byAuthor = new Map((best as Placement[]).map((p) => [p.author, p]));
  return authors.map((a) => byAuthor.get(a)!);
}

/** Exposed for tests: total score of a configuration including neighbour term. */
export function scorePlacement(
  config: readonly Placement[],
  addresseesOf: ReadonlyMap<string, readonly string[]>,
  previousPositions: ReadonlyMap<string, number>,
  penalties: FacingPenalties,
): number {
  return (
    scoreConfiguration(config, addresseesOf, penalties) +
    neighborPenalty(config, previousPositions, penalties)
  );
}
