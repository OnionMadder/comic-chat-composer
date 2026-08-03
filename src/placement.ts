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
 *
 * The six weights are the paper's, and match the shipped C++ (`EvalPair` in
 * `panel.cpp`) exactly.
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
 *
 * A character whose facing the author fixed is never scored on it — they are
 * treated as facing whoever we are comparing them against. The alternative is
 * worse than it looks: the facing terms are the dominant ones, so a fixed
 * facing that disagrees with an addressee would leave a 40-point penalty the
 * solver cannot pay off by turning anyone, and it would spend the rest of the
 * search dragging the whole cast around the panel trying. Exempting the fixed
 * character leaves the seating exactly where it would have been.
 */
function scorePair(
  a: Placement,
  b: Placement,
  addresseesOf: ReadonlyMap<string, readonly string[]>,
  between: number,
  w: FacingPenalties,
  locked: ReadonlySet<string>,
): number {
  const addressed = addresseesOf.get(a.author) ?? [];
  const aAddressedB = addressed.includes(b.author);
  const aFacesB = locked.has(a.author) || isFacing(a, b);
  const bFacesA = locked.has(b.author) || isFacing(b, a);

  let s = 0;
  if (aAddressedB) {
    if (!bFacesA) s += w.addrOtherNotFacing;
    if (!aFacesB) s += w.addrNotFacing;
    s += w.addrBetweenFactor * between;
  } else if (addressed.length === 0) {
    // The paper's first two weights are for a speaker who "has not addressed
    // his utterance" — a general statement to the room, where it is worth
    // facing anyone. They must not apply to the *bystanders* of a directed
    // utterance: testing "did not address b" instead of "addressed nobody"
    // made a speaker who is talking to one character also pay for turning
    // away from everyone else, which pulled them round to face the crowd
    // rather than committing to their addressee.
    if (!aFacesB) s += w.notAddrNotFacing;
    if (!bFacesA) s += w.notAddrOtherNotFacing;
  }
  return s;
}

/** Total pairwise score for a complete configuration. */
function scoreConfiguration(
  config: readonly Placement[],
  addresseesOf: ReadonlyMap<string, readonly string[]>,
  w: FacingPenalties,
  locked: ReadonlySet<string> = EMPTY_LOCKS,
): number {
  let total = 0;
  for (const a of config) {
    for (const b of config) {
      if (a === b) continue;
      total += scorePair(a, b, addresseesOf, countBetween(config as Placement[], a, b), w, locked);
    }
  }
  return total;
}

const EMPTY_LOCKS: ReadonlySet<string> = new Set<string>();

/** Who stood immediately left and right of each character, by x order. */
function neighborsByAuthor(
  entries: readonly { author: string; x: number }[],
): Map<string, { left: string | null; right: string | null }> {
  const sorted = [...entries].sort((p, q) => p.x - q.x);
  const map = new Map<string, { left: string | null; right: string | null }>();
  sorted.forEach((p, i) => {
    map.set(p.author, {
      left: sorted[i - 1]?.author ?? null,
      right: sorted[i + 1]?.author ?? null,
    });
  });
  return map;
}

/**
 * The `Neighbors` term: one point per side whose occupant changed since the
 * previous panel — the paper counts, for a character's left and right
 * neighbours, "each of these that is different from the character last
 * appearing there".
 *
 * Comparing *identities* rather than x coordinates matters because the slots
 * are evenly spread across the panel width: any change in cast size shifts
 * every x at once, so a coordinate-based term fires for everyone uniformly and
 * exerts no preference at all — precisely when a character joins or leaves,
 * which is when panel-to-panel stability is worth the most. Neighbour identity
 * keeps the cast's relative order stable across those changes instead.
 */
function neighborPenalty(
  config: readonly Placement[],
  previousPositions: ReadonlyMap<string, number>,
  w: FacingPenalties,
): number {
  if (previousPositions.size === 0) return 0;

  const before = neighborsByAuthor(
    [...previousPositions].map(([author, x]) => ({ author, x })),
  );
  const now = neighborsByAuthor(config);

  let total = 0;
  for (const p of config) {
    const wasThere = before.get(p.author);
    if (!wasThere) continue; // no history for a newcomer — nothing to preserve
    const isThere = now.get(p.author)!;
    // A neighbour who has left the panel entirely is not a "change" the
    // seating can do anything about; only compare against characters still
    // present, so the term keeps ranking the orderings we can actually choose.
    if (wasThere.left !== isThere.left && stillPresent(wasThere.left, config)) {
      total += w.neighborChange;
    }
    if (wasThere.right !== isThere.right && stillPresent(wasThere.right, config)) {
      total += w.neighborChange;
    }
  }
  return total;
}

/** Whether a previous neighbour (or the panel edge) is still in this panel. */
function stillPresent(author: string | null, config: readonly Placement[]): boolean {
  return author === null || config.some((p) => p.author === author);
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
  /**
   * Facings the author fixed by hand, by author. The solver still chooses where
   * these characters stand; it just does not choose which way they look.
   *
   * The case this exists for is a character addressing someone who is not in
   * the panel at all — the scoring function only knows about people who are, so
   * left to itself it will always turn them back towards the room.
   */
  facingLocks?: ReadonlyMap<string, Facing>;
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
  const locks = options.facingLocks ?? EMPTY_FACING_LOCKS;
  const locked: ReadonlySet<string> = new Set(locks.keys());
  const n = authors.length;
  if (n === 0) return [];

  const slots = Array.from({ length: n }, (_, i) => ((i + 1) * panelWidth) / (n + 1));

  const placed: Placement[] = [];
  for (const author of authors) {
    const used = new Set(placed.map((p) => p.x));
    let best: Placement | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    // A fixed facing is not a candidate to choose between — it is the answer.
    const facings = facingsFor(author, locks);

    for (const x of slots) {
      if (used.has(x)) continue;
      for (const facing of facings) {
        const trial: Placement = { author, x, facing };
        const config = [...placed, trial];
        const score =
          scoreConfiguration(config, addresseesOf, penalties, locked) +
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
    scoreConfiguration(config, addresseesOf, penalties, locked) +
    neighborPenalty(config, previousPositions, penalties);

  let improved = true;
  while (improved) {
    improved = false;
    let current = totalScore(placed);

    // Move 1: flip one character's facing. Not one whose facing is fixed.
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]!;
      if (locked.has(p.author)) continue;
      const candidate = placed.slice();
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
    const exact = exhaustiveBest(placed, slots, totalScore, locks);
    if (exact) return exact;
  }

  return placed;
}

const EMPTY_FACING_LOCKS: ReadonlyMap<string, Facing> = new Map<string, Facing>();

/** The facings worth trying for one author: both, or the one they were given. */
function facingsFor(author: string, locks: ReadonlyMap<string, Facing>): readonly Facing[] {
  const fixed = locks.get(author);
  return fixed ? [fixed] : BOTH_FACINGS;
}

const BOTH_FACINGS: readonly Facing[] = ['left', 'right'];

/**
 * Largest cast for which every seating and facing is enumerated. The paper caps
 * a panel at five characters, so this covers every panel in practice while
 * keeping the factorial cost bounded (5! × 2^5 = 3840 configurations).
 */
const EXHAUSTIVE_MAX = 5;

/**
 * Enumerate every seating and facing, returning the best strictly-better
 * configuration over the whole space, or `null` if the incumbent is already
 * optimal.
 */
function exhaustiveBest(
  incumbent: readonly Placement[],
  slots: readonly number[],
  totalScore: (config: readonly Placement[]) => number,
  locks: ReadonlyMap<string, Facing>,
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
          // A fixed facing overrides the bit for that character, so the search
          // still covers every seating without ever proposing a turn the author
          // ruled out. Enumerating those masks and discarding them would be the
          // same answer at 2^k times the cost.
          facing: locks.get(author) ?? (mask & (1 << i) ? 'right' : 'left'),
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
