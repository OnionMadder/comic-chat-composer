import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  balloonControlPoints,
  balloonOutlinePath,
  fitControlPoints,
  smoothHalfWidths,
  splineToPath,
  type BalloonShapeOptions,
} from '../examples/balloon-shape.ts';

function options(overrides: Partial<BalloonShapeOptions> = {}): BalloonShapeOptions {
  return {
    lineWidths: [100, 80],
    centreX: 200,
    textTop: 20,
    lineHeight: 15,
    margin: 9,
    ...overrides,
  };
}

describe('smoothHalfWidths — the anti-amoeba rules (§5.3)', () => {
  it('never dips inward on one line only to bulge out on the next', () => {
    // A narrow middle line between two wide ones must not pinch the outline.
    const out = smoothHalfWidths([50, 20, 50], 0);
    assert.equal(out[1], 50, 'the dip should be filled to its neighbours');
  });

  it('leaves a genuine step alone', () => {
    // Monotonic narrowing is a real change in the text outline, not a dip.
    const out = smoothHalfWidths([50, 30, 20], 0);
    assert.deepEqual(out, [50, 30, 20]);
  });

  it('ignores shifts smaller than the threshold', () => {
    const out = smoothHalfWidths([50, 48, 47], 5);
    assert.deepEqual(out, [50, 50, 50], 'small wobbles should be flattened');
  });

  it('still responds to a shift larger than the threshold', () => {
    const out = smoothHalfWidths([50, 48, 20], 5);
    assert.equal(out[0], 50);
    assert.equal(out[1], 50, 'small change held');
    assert.equal(out[2], 20, 'large change accepted');
  });

  it('handles a single line', () => {
    assert.deepEqual(smoothHalfWidths([40], 5), [40]);
  });
});

describe('balloonControlPoints', () => {
  it('expands the outline outward from the text by the margin', () => {
    const pts = balloonControlPoints(options({ lineWidths: [100], margin: 9 }));
    const right = Math.max(...pts.map((p) => p.x));
    // 200 centre + 50 half-width + 9 margin.
    assert.equal(right, 259);
  });

  it('is symmetric about the centre when there is no perturbation', () => {
    const pts = balloonControlPoints(options({ lineWidths: [100, 60] }));
    const left = Math.min(...pts.map((p) => p.x));
    const right = Math.max(...pts.map((p) => p.x));
    assert.equal(right - 200, 200 - left);
  });

  it('interpolates the tail tip with multiplicity 3 for a sharp corner', () => {
    const tip = { fromX: 190, fromY: 65, toX: 150, toY: 160, curve: 'ccw' as const };
    const pts = balloonControlPoints(options({ tail: tip }));
    const atTip = pts.filter((p) => p.x === 150 && p.y === 160);
    assert.equal(atTip.length, 3, 'tip must be repeated three times');
  });

  it('adds no tail points when there is no tail', () => {
    const pts = balloonControlPoints(options({ tail: null }));
    const bottom = Math.max(...pts.map((p) => p.y));
    // Bottom is the last line plus a margin, nothing reaching further down.
    assert.equal(bottom, 20 + 2 * 15 + 9);
  });

  it('keeps the bottom of the outline monotonic in x across a tail', () => {
    const pts = balloonControlPoints(
      options({ tail: { fromX: 260, fromY: 65, toX: 300, toY: 160, curve: 'cw' } }),
    );
    // The tail mouth is clamped inside the bottom edge, so the outline never
    // doubles back on itself before reaching the tip.
    const bottomY = 20 + 2 * 15 + 9;
    const alongBottom = pts.filter((p) => p.y === bottomY).map((p) => p.x);
    // Non-increasing, with a tolerance: the shoulder and the clamped mouth can
    // land on the same coordinate computed two different ways.
    for (let i = 1; i < alongBottom.length; i++) {
      assert.ok(
        alongBottom[i]! <= alongBottom[i - 1]! + 1e-9,
        `bottom must run right to left, got ${alongBottom.join(', ')}`,
      );
    }
  });

  it('adds low-frequency waves on long unchanging runs (rule 4)', () => {
    const flat = [90, 90, 90, 90, 90];
    const plain = balloonControlPoints(options({ lineWidths: flat, perturbationRun: 99 }));
    const waved = balloonControlPoints(options({ lineWidths: flat, perturbationRun: 3 }));

    // Same control points either way — the waves move them off the flat edge
    // rather than adding new ones.
    assert.equal(waved.length, plain.length);
    const plainXs = new Set(plain.map((p) => p.x));
    assert.ok(
      waved.some((p) => !plainXs.has(p.x)),
      'a long flat run should be perturbed off the straight edge',
    );
  });

  it('alternates the waves toward and away from the text', () => {
    const waved = balloonControlPoints(
      options({ lineWidths: [90, 90, 90, 90, 90], perturbationRun: 3, perturbationAmplitude: 5 }),
    );
    // The flat edge sits at 45 + 9 = 54 from the centre; waves land either side.
    const rightEdge = waved.filter((p) => p.x > 200).map((p) => p.x - 200);
    assert.ok(rightEdge.some((d) => d > 54.1), 'some waves push outward');
    assert.ok(rightEdge.some((d) => d < 53.9), 'some waves pull inward');
  });

  it('adds no waves to a short balloon', () => {
    const a = balloonControlPoints(options({ lineWidths: [90, 90], perturbationRun: 3 }));
    const b = balloonControlPoints(options({ lineWidths: [90, 90], perturbationRun: 99 }));
    assert.deepEqual(a, b);
  });
});

describe('splineToPath', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('produces a closed cubic path', () => {
    const d = splineToPath(square, 5);
    assert.match(d, /^M /);
    assert.match(d, /Z$/);
    assert.equal((d.match(/C /g) ?? []).length, square.length, 'one segment per control point');
  });

  /**
   * Points the curve actually passes through: the initial `M` plus the final
   * coordinate pair of each `C`. The two middle pairs of a `C` are control
   * handles, which may sit outside the curve entirely.
   */
  const onCurvePoints = (d: string): Array<{ x: number; y: number }> => {
    const pts: Array<{ x: number; y: number }> = [];
    const move = /M (-?[\d.]+) (-?[\d.]+)/.exec(d)!;
    pts.push({ x: Number(move[1]), y: Number(move[2]) });
    for (const m of d.matchAll(/C [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ (-?[\d.]+) (-?[\d.]+)/g)) {
      pts.push({ x: Number(m[1]), y: Number(m[2]) });
    }
    return pts;
  };

  it('collapses onto the control polygon at infinite tension', () => {
    // t = tension/(tension+5), so a very large tension approaches 1, where each
    // segment becomes the straight edge between two vertices.
    const d = splineToPath(square, 1e6);
    for (const p of onCurvePoints(d)) {
      const onVertex = square.some(
        (v) => Math.abs(v.x - p.x) < 0.05 && Math.abs(v.y - p.y) < 0.05,
      );
      assert.ok(onVertex, `(${p.x},${p.y}) should be a polygon vertex`);
    }
  });

  it('pulls strictly inside the polygon at zero tension', () => {
    // A pure uniform B-spline is not interpolating — it never reaches the
    // corners of its own control polygon.
    const d = splineToPath(square, 0);
    for (const p of onCurvePoints(d)) {
      assert.ok(p.x > 0 && p.x < 10, `x=${p.x} should be strictly inside`);
      assert.ok(p.y > 0 && p.y < 10, `y=${p.y} should be strictly inside`);
    }
  });

  it('returns nothing for a degenerate polygon', () => {
    assert.equal(splineToPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5), '');
  });
});

describe('fitControlPoints', () => {
  /** Where the curve actually lands at each knot, for the given tension. */
  const curveAt = (pts: Array<{ x: number; y: number }>, tension: number) => {
    const n = pts.length;
    const t = tension / (tension + 5);
    const at = (i: number) => pts[((i % n) + n) % n]!;
    return pts.map((_, i) => {
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const sx = (a.x + 4 * b.x + c.x) / 6;
      const sy = (a.y + 4 * b.y + c.y) / 6;
      return { x: sx + (b.x - sx) * t, y: sy + (b.y - sy) * t };
    });
  };

  it('makes the curve pass through the requested boundary', () => {
    const targets = balloonControlPoints(options({ lineWidths: [200, 90] }));
    const fitted = fitControlPoints(targets, 5);
    const actual = curveAt(fitted, 5);
    for (let i = 0; i < targets.length; i++) {
      assert.ok(
        Math.hypot(actual[i]!.x - targets[i]!.x, actual[i]!.y - targets[i]!.y) < 0.5,
        `knot ${i} landed ${JSON.stringify(actual[i])}, wanted ${JSON.stringify(targets[i])}`,
      );
    }
  });

  it('is what stops the outline pulling inside the text', () => {
    // Regression: an unfitted spline is dragged inside the boundary it should
    // touch, so text spills out. Fitting must pull the curve back to the edge.
    const targets = balloonControlPoints(options({ lineWidths: [200, 90] }));
    const wanted = Math.max(...targets.map((p) => p.x));

    const naive = Math.max(...curveAt(targets, 5).map((p) => p.x));
    const fitted = Math.max(...curveAt(fitControlPoints(targets, 5), 5).map((p) => p.x));

    assert.ok(naive < wanted - 0.5, 'unfitted spline should fall short (that was the bug)');
    assert.ok(fitted > naive, 'fitting should push the curve back outward');
    assert.ok(Math.abs(fitted - wanted) < 1, 'fitted spline should reach the boundary');
  });

  it('leaves repeated points pinned so the tail tip stays sharp', () => {
    const targets = balloonControlPoints(
      options({ tail: { fromX: 195, fromY: 65, toX: 150, toY: 160, curve: 'ccw' } }),
    );
    const fitted = fitControlPoints(targets, 5);
    const tips = fitted.filter((p) => Math.abs(p.x - 150) < 1e-9 && Math.abs(p.y - 160) < 1e-9);
    assert.equal(tips.length, 3, 'the three tip points must remain coincident');
  });

  it('passes short polygons through untouched', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    assert.deepEqual(fitControlPoints(two, 5), two);
  });
});

describe('balloonOutlinePath', () => {
  it('emits a valid closed path for a normal balloon', () => {
    const d = balloonOutlinePath(options());
    assert.match(d, /^M [\d.-]+ [\d.-]+ C/);
    assert.match(d, /Z$/);
    assert.ok(!d.includes('NaN'), 'no NaN coordinates');
  });

  it('emits a valid path with a tail spliced in', () => {
    const d = balloonOutlinePath(
      options({ tail: { fromX: 195, fromY: 65, toX: 160, toY: 160, curve: 'ccw' } }),
    );
    assert.ok(!d.includes('NaN'));
    assert.match(d, /Z$/);
  });

  it('is deterministic', () => {
    assert.equal(balloonOutlinePath(options()), balloonOutlinePath(options()));
  });

  it('survives a one-line balloon', () => {
    const d = balloonOutlinePath(options({ lineWidths: [40] }));
    assert.ok(!d.includes('NaN'));
    assert.match(d, /Z$/);
  });

  it('survives an empty line list', () => {
    const d = balloonOutlinePath(options({ lineWidths: [] }));
    assert.ok(!d.includes('NaN'));
  });
});
