import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { placeCharacters, scorePlacement, type Placement } from '../src/placement.ts';
import { DEFAULT_FACING_PENALTIES } from '../src/compose.ts';

const penalties = DEFAULT_FACING_PENALTIES;
const noPrevious = new Map<string, number>();

function place(authors: string[], addressees: Record<string, string[]>): Placement[] {
  return placeCharacters({
    authors,
    addresseesOf: new Map(Object.entries(addressees)),
    previousPositions: noPrevious,
    panelWidth: 400,
    penalties,
  });
}

/** Brute-force optimum over all orderings and facings, for small n. */
function bruteForce(authors: string[], addressees: Record<string, string[]>): number {
  const addresseesOf = new Map(Object.entries(addressees));
  const n = authors.length;
  const slots = Array.from({ length: n }, (_, i) => ((i + 1) * 400) / (n + 1));

  const permutations = (xs: string[]): string[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) =>
          permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
        );

  let best = Number.POSITIVE_INFINITY;
  for (const order of permutations(authors)) {
    for (let mask = 0; mask < 1 << n; mask++) {
      const config: Placement[] = order.map((author, i) => ({
        author,
        x: slots[i]!,
        facing: mask & (1 << i) ? 'right' : 'left',
      }));
      best = Math.min(best, scorePlacement(config, addresseesOf, noPrevious, penalties));
    }
  }
  return best;
}

describe('placeCharacters', () => {
  it('places every author exactly once', () => {
    const placed = place(['alice', 'bob', 'cara'], {});
    assert.equal(placed.length, 3);
    assert.equal(new Set(placed.map((p) => p.author)).size, 3);
    assert.equal(new Set(placed.map((p) => p.x)).size, 3, 'no two characters share a slot');
  });

  it('turns a speaker toward the person they addressed', () => {
    const placed = place(['alice', 'bob'], { alice: ['bob'] });
    const alice = placed.find((p) => p.author === 'alice')!;
    const bob = placed.find((p) => p.author === 'bob')!;
    const aliceFacesBob = alice.facing === 'right' ? bob.x > alice.x : bob.x < alice.x;
    assert.ok(aliceFacesBob, 'the 40-point penalty must dominate');
  });

  it('turns both speakers toward each other in a two-way exchange', () => {
    const placed = place(['alice', 'bob'], { alice: ['bob'], bob: ['alice'] });
    const [a, b] = [placed.find((p) => p.author === 'alice')!, placed.find((p) => p.author === 'bob')!];
    const aFacesB = a.facing === 'right' ? b.x > a.x : b.x < a.x;
    const bFacesA = b.facing === 'right' ? a.x > b.x : a.x < b.x;
    assert.ok(aFacesB && bFacesA);
  });

  it('matches the brute-force optimum for small casts', () => {
    const cases: Array<[string[], Record<string, string[]>]> = [
      [['alice', 'bob'], { alice: ['bob'] }],
      [['alice', 'bob'], { alice: ['bob'], bob: ['alice'] }],
      [['alice', 'bob', 'cara'], { alice: ['cara'] }],
      [['alice', 'bob', 'cara'], { alice: ['bob'], cara: ['bob'] }],
      [['alice', 'bob', 'cara', 'dan'], { alice: ['dan'], bob: ['cara'] }],
      // The paper's five-character cap — the largest panel the composer builds.
      [
        ['alice', 'bob', 'cara', 'dan', 'eve'],
        { alice: ['eve'], cara: ['bob'], dan: ['alice'] },
      ],
    ];
    for (const [authors, addressees] of cases) {
      const placed = place(authors, addressees);
      const actual = scorePlacement(placed, new Map(Object.entries(addressees)), noPrevious, penalties);
      const optimal = bruteForce(authors, addressees);
      assert.ok(
        actual <= optimal + 1e-9,
        `greedy+hillclimb scored ${actual}, optimum is ${optimal} for ${authors.join(',')}`,
      );
    }
  });

  it('prefers to keep characters where they were in the previous panel', () => {
    // Slots are derived from the character count, so a "previous position"
    // only carries weight when it coincides with a slot in this panel. For two
    // characters in a 400-wide panel the slots are 400/3 and 800/3.
    const left = 400 / 3;
    const right = 800 / 3;
    const previousPositions = new Map([
      ['alice', right],
      ['bob', left],
    ]);
    const placed = placeCharacters({
      authors: ['alice', 'bob'],
      addresseesOf: new Map(),
      previousPositions,
      panelWidth: 400,
      penalties,
    });
    // With no addressing pressure the neighbour term is the only signal, so
    // both characters should land back where they stood.
    assert.equal(placed.find((p) => p.author === 'alice')!.x, right);
    assert.equal(placed.find((p) => p.author === 'bob')!.x, left);
  });

  it('returns an empty layout for an empty cast', () => {
    assert.deepEqual(place([], {}), []);
  });
});
