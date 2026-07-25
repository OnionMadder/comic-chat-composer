/**
 * Cross-check the §5.2 routing-channel primitives against the original Comic
 * Chat source.
 *
 * This port reconstructs the routing algorithm from the SIGGRAPH '96 *paper*,
 * whose pseudocode for `MaxAllowable` / `ReduceChannel` is ambiguous in two
 * places (see the notes in `src/balloons.ts`). An independent line-by-line
 * transcription of the actual C++ (`balloon.cpp`) exists in the community
 * project remsky/comic-chat-web, as `QueryRoute` / `SetRoute` on the balloon
 * runtime. Those are effectively ground truth for the algorithm's intent.
 *
 * Below is a faithful re-expression of that source logic, then a fuzz that
 * asserts our `maxAllowable` / `reduceChannel` agree with it across a wide grid
 * of channel and speaker configurations. If they ever diverge again, this test
 * localises it to the exact inputs.
 *
 * Reference: https://github.com/remsky/comic-chat-web — src/engine/panelBalloon.ts
 * (`BalloonRuntime.queryRoute` and `.setRoute`). Comic Chat is MIT-licensed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { maxAllowable, reduceChannel, type Interval } from '../src/balloons.ts';

const HUGE = 1e9;

/**
 * Oracle: the constraint the prior channel `Ri` (speaker `xi`) imposes on a new
 * balloon whose speaker is `newX`, as an allowable `[lo, hi]` interval —
 * `QueryRoute` from the source. `t` is the minimum route width (`MINROUTEWIDTH`).
 * One side is always unbounded; the caller intersects it with the new channel.
 */
function queryRoute(Ri: Interval, xi: number, newX: number, t: number): [number, number] {
  if (newX > xi) return [Math.max(xi, Ri.l + t), HUGE];
  return [-HUGE, Math.min(xi, Ri.r - t)];
}

/** Oracle: `SetRoute` — shrink prior `Ri` so it no longer overlaps new `[l, r]`. */
function setRoute(Ri: Interval, xi: number, newX: number, l: number, r: number): Interval {
  if (newX > xi) return { l: Ri.l, r: Math.min(Ri.r, l) };
  return { l: Math.max(Ri.l, r), r: Ri.r };
}

/** Apply the oracle's QueryRoute constraint to a concrete new channel Rj. */
function maxAllowableOracle(Ri: Interval, xi: number, Rj: Interval, xj: number, t: number): Interval {
  const [lo, hi] = queryRoute(Ri, xi, xj, t);
  return { l: Math.max(Rj.l, lo), r: Math.min(Rj.r, hi) };
}

function* configs(): Generator<{ Ri: Interval; xi: number; Rj: Interval; xj: number; t: number }> {
  const edges = [0, 30, 60, 90, 140, 200, 260, 320, 400];
  const t = 14;
  for (const rl of edges) {
    for (const rr of edges) {
      if (rr <= rl) continue;
      const Ri = { l: rl, r: rr };
      for (const xi of [rl, rl + 5, (rl + rr) / 2, rr - 5, rr]) {
        for (const jl of edges) {
          for (const jr of edges) {
            if (jr <= jl) continue;
            const Rj = { l: jl, r: jr };
            for (const xj of [jl, (jl + jr) / 2, jr]) {
              if (xj === xi) continue; // ties resolve elsewhere; skip the degenerate case
              yield { Ri, xi, Rj, xj, t };
            }
          }
        }
      }
    }
  }
}

describe('§5.2 routing primitives vs the Comic Chat source', () => {
  it('maxAllowable agrees with the source QueryRoute across a grid', () => {
    let checked = 0;
    for (const { Ri, xi, Rj, xj, t } of configs()) {
      const ours = maxAllowable(Ri, xi, Rj, xj, t);
      const oracle = maxAllowableOracle(Ri, xi, Rj, xj, t);
      // The oracle's unbounded side maps to Rj's own edge, which is exactly what
      // our version leaves untouched — so the two intervals must match outright.
      assert.deepEqual(
        { l: ours.l, r: ours.r },
        { l: oracle.l, r: oracle.r },
        `maxAllowable mismatch: Ri=${JSON.stringify(Ri)} xi=${xi} Rj=${JSON.stringify(Rj)} xj=${xj}`,
      );
      checked++;
    }
    assert.ok(checked > 5000, `expected a broad grid, only checked ${checked}`);
  });

  it('reduceChannel agrees with the source SetRoute across a grid', () => {
    for (const { Ri, xi, Rj, xj } of configs()) {
      const ours = reduceChannel(Ri, xi, Rj, xj);
      // SetRoute is applied to the *prior* channel using the new channel's edges.
      const oracle = setRoute(Ri, xi, xj, Rj.l, Rj.r);
      assert.deepEqual(
        { l: ours.l, r: ours.r },
        { l: oracle.l, r: oracle.r },
        `reduceChannel mismatch: Ri=${JSON.stringify(Ri)} xi=${xi} Rj=${JSON.stringify(Rj)} xj=${xj}`,
      );
    }
  });

  it('after maxAllowable then reduceChannel, the two channels are disjoint', () => {
    // The property the whole dance exists to guarantee: once the new channel is
    // trimmed and the prior one reduced, their tail corridors don't overlap.
    for (const { Ri, xi, Rj, xj, t } of configs()) {
      const trimmed = maxAllowable(Ri, xi, Rj, xj, t);
      if (trimmed.r <= trimmed.l) continue; // new balloon didn't fit; a panel break
      const reduced = reduceChannel(Ri, xi, trimmed, xj);
      if (reduced.r <= reduced.l) continue;
      const overlap = Math.min(reduced.r, trimmed.r) - Math.max(reduced.l, trimmed.l);
      assert.ok(overlap <= 1e-6, `channels overlap by ${overlap}`);
    }
  });
});
