import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRandom, randomBetween, seededIndex } from '../src/rng.ts';

describe('createRandom', () => {
  it('is deterministic for a given seed', () => {
    const a = createRandom(123);
    const b = createRandom(123);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  it('returns values in [0, 1)', () => {
    const r = createRandom(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1);
    }
  });
});

describe('randomBetween', () => {
  it('stays within the range and collapses an empty range to lo', () => {
    const r = createRandom(1);
    for (let i = 0; i < 200; i++) {
      const v = randomBetween(r, 10, 20);
      assert.ok(v >= 10 && v <= 20);
    }
    assert.equal(randomBetween(r, 5, 5), 5);
    assert.equal(randomBetween(r, 5, 1), 5);
  });
});

describe('seededIndex', () => {
  it('is deterministic and in range', () => {
    for (let seed = 0; seed < 50; seed++) {
      const i = seededIndex(seed, 9);
      assert.ok(Number.isInteger(i) && i >= 0 && i < 9);
      assert.equal(i, seededIndex(seed, 9), 'same seed → same index');
    }
  });

  it('handles trivial counts', () => {
    assert.equal(seededIndex(999, 1), 0);
    assert.equal(seededIndex(999, 0), 0);
  });

  it('spreads the small sequential seeds people type across all buckets', () => {
    // The whole point: seeds 1..90 over 9 buckets should be roughly flat, with
    // every bucket used — unlike a PRNG stream's clustered first output.
    const buckets = new Array(9).fill(0);
    for (let seed = 1; seed <= 90; seed++) buckets[seededIndex(seed, 9)]++;
    assert.ok(
      buckets.every((n) => n > 0),
      `every bucket used: ${buckets.join(',')}`,
    );
    const max = Math.max(...buckets);
    const min = Math.min(...buckets);
    assert.ok(max - min <= 10, `roughly uniform (spread ${min}..${max})`);
  });

  it('decorrelates adjacent seeds', () => {
    let same = 0;
    for (let seed = 1; seed < 300; seed++) {
      if (seededIndex(seed, 9) === seededIndex(seed + 1, 9)) same++;
    }
    // Independent picks would collide ~1/9 of the time; a correlated stream far
    // more. Assert we're near the independent rate, not stuck.
    assert.ok(same / 299 < 0.2, `adjacent-equal rate ${(same / 299).toFixed(3)}`);
  });
});
