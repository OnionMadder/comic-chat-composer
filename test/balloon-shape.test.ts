import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  balloonControlPoints,
  balloonOutlinePath,
  fitControlPoints,
  smoothHalfWidths,
  splineToPath,
  starburstPoints,
  type BalloonShapeOptions,
  type Point,
} from '../examples/balloon-shape.ts';
import { createRandom } from '../src/rng.ts';

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

  it('interpolates a knot sitting at the polygon\'s own extremum', () => {
    // Regression: control points were bounded to the *targets'* bounding box
    // plus 4px. A B-spline is approximating, so interpolating a knot means
    // placing its control point outside it — and for a knot at or near the
    // extremum that lands beyond the box, where the clamp stopped it. The cap
    // shoulder of a wide balloon is exactly such a knot, so it fell short and
    // the outline ran inside the text. The bound now admits the overshoot the
    // interpolation itself requires.
    const targets = balloonControlPoints(
      options({ lineWidths: [347.16], centreX: 209.99, textTop: 30, margin: 8.25 }),
    );
    const actual = curveAt(fitControlPoints(targets, 5), 5);
    for (let i = 0; i < targets.length; i++) {
      const miss = Math.hypot(actual[i]!.x - targets[i]!.x, actual[i]!.y - targets[i]!.y);
      assert.ok(miss < 0.5, `knot ${i} fell ${miss.toFixed(2)}px short of its target`);
    }
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

describe('text containment — the outline must hold the text drawn inside it', () => {
  // These mirror render-svg.ts: the renderer's outline margin, and where glyph
  // ink sits within a line box (font-size 0.78 × lineHeight, baseline at 0.78).
  // The two line heights are the two shipping callers — the app's approximate
  // metrics (15) and the demo's (22) — because the geometry is not scale-free:
  // the margin grows with the line height but the cap and tail insets are
  // capped in absolute terms, so a bug can live at one and not the other.
  const APP_LINE_HEIGHT = 15;
  const DEMO_LINE_HEIGHT = 22;
  const marginFor = (lineHeight: number): number => Math.max(6, lineHeight * 0.55);
  const inkBandOf = (lineHeight: number): { top: number; bottom: number } => {
    const fontSize = lineHeight * 0.78;
    return {
      top: 0.78 * lineHeight - 0.75 * fontSize,
      bottom: 0.78 * lineHeight + 0.22 * fontSize,
    };
  };

  /**
   * Flatten the path `balloonOutlinePath` actually emits.
   *
   * Sampling a curve re-derived from the control points is a *different* test.
   * `fitControlPoints` does not preserve its targets as on-curve points, so the
   * shipped outline can run inside a control polygon that satisfies the margin
   * perfectly — which is precisely where a containment bug hides. So parse the
   * `d` string, rounding and all, and measure that.
   */
  const flattenPath = (d: string, perSegment = 24): Point[] => {
    const out: Point[] = [];
    const move = /M\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(d);
    if (!move) return out;
    let cur: Point = { x: Number(move[1]), y: Number(move[2]) };
    out.push(cur);
    const curve = /C\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g;
    for (const m of d.matchAll(curve)) {
      const b0 = cur;
      const b1 = { x: Number(m[1]), y: Number(m[2]) };
      const b2 = { x: Number(m[3]), y: Number(m[4]) };
      const b3 = { x: Number(m[5]), y: Number(m[6]) };
      for (let s = 1; s <= perSegment; s++) {
        const u = s / perSegment;
        const k = 1 - u;
        out.push({
          x: k * k * k * b0.x + 3 * k * k * u * b1.x + 3 * k * u * u * b2.x + u * u * u * b3.x,
          y: k * k * k * b0.y + 3 * k * k * u * b1.y + 3 * k * u * u * b2.y + u * u * u * b3.y,
        });
      }
      cur = b3;
    }
    return out;
  };

  /** Widest x-interval the polygon covers at height y. */
  const xExtentAt = (poly: readonly Point[], y: number): { l: number; r: number } | null => {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (xs.length < 2) return null;
    xs.sort((p, q) => p - q);
    return { l: xs[0]!, r: xs[xs.length - 1]! };
  };

  /**
   * Largest distance any line's glyph ink pokes outside the polygon.
   *
   * The band is swept rather than sampled at three heights: the outline is a
   * curve, so the closest approach need not land on a line's top, middle or
   * bottom.
   */
  const worstOverflow = (
    poly: readonly Point[],
    lineWidths: readonly number[],
    centreX: number,
    textTop: number,
    lineHeight: number,
  ): number => {
    const ink = inkBandOf(lineHeight);
    let worst = -Infinity;
    for (let i = 0; i < lineWidths.length; i++) {
      const lw = lineWidths[i]!;
      const top = textTop + i * lineHeight + ink.top;
      const bottom = textTop + i * lineHeight + ink.bottom;
      for (let s = 0; s <= 16; s++) {
        const ext = xExtentAt(poly, top + ((bottom - top) * s) / 16);
        if (!ext) return Infinity;
        worst = Math.max(worst, ext.l - (centreX - lw / 2), centreX + lw / 2 - ext.r);
      }
    }
    return worst;
  };

  const splineOverflow = (
    lineWidths: number[],
    withTail: boolean,
    lineHeight = APP_LINE_HEIGHT,
    centreX = 200,
  ): number => {
    const margin = marginFor(lineHeight);
    const textTop = 30;
    const bottomY = textTop + lineWidths.length * lineHeight + margin;
    const d = balloonOutlinePath({
      lineWidths,
      centreX,
      textTop,
      lineHeight,
      margin,
      tail: withTail
        ? { fromX: centreX + 10, fromY: bottomY, toX: centreX + 40, toY: bottomY + 60, curve: 'cw' }
        : null,
    });
    return worstOverflow(flattenPath(d), lineWidths, centreX, textTop, lineHeight);
  };

  it('keeps a wide line clear of the outline across a much narrower neighbour', () => {
    // Regression: the midpoint control between two lines sat at the mean of
    // their widths, slicing the wide line's corner glyphs whenever the widths
    // differed by more than two margins.
    assert.ok(splineOverflow([281, 76], false) <= 0.5);
    assert.ok(splineOverflow([83, 292, 87], false) <= 0.5);
  });

  it('keeps a line held down by rule 3 clear of the outline', () => {
    // Regression: rule 3 could flatten a *wider* line down to an earlier,
    // narrower width, leaving its corner glyphs grazing (or outside) the
    // outline. Halves of 86 and 70 differ by less than the margin threshold.
    assert.ok(splineOverflow([42, 70, 86, 49], false) <= 0.5);
  });

  it('keeps wide first and last lines clear of the cap and tail shoulders', () => {
    // Regression: the shoulder inset grew with the line width, so wide enough
    // first/last lines had their corners cut by the cap (or the run down to
    // the tail mouth).
    assert.ok(splineOverflow([300], false) <= 0.5);
    assert.ok(splineOverflow([300, 280], true) <= 0.5);
  });

  it('draws the cap shoulder outside the text it caps, on the curve', () => {
    // Regression: the shoulder was correct on the control polygon and wrong on
    // the emitted curve. `fitControlPoints` bounded its control points to the
    // targets' own extent, and interpolating a knot needs its control point
    // pushed *past* that knot — so on a wide single-line balloon the clamp bound
    // exactly at the shoulder and the curve came back ~7px short, inside the
    // text. The polygon-only sweeps could not see it.
    const options = {
      lineWidths: [347.16],
      centreX: 209.99,
      textTop: 30,
      lineHeight: APP_LINE_HEIGHT,
      margin: 8.25,
      tail: null,
    };
    const shoulder = balloonControlPoints(options)[1]!;
    const onCurve = flattenPath(balloonOutlinePath(options), 1);

    // The emitted curve must actually pass through the shoulder it was fitted to.
    const nearest = Math.min(...onCurve.map((p) => Math.hypot(p.x - shoulder.x, p.y - shoulder.y)));
    assert.ok(nearest < 0.5, `curve misses its own shoulder by ${nearest.toFixed(2)}px`);

    // And that shoulder has to clear the text: half of 347.16 is 173.58.
    assert.ok(
      shoulder.x > 209.99 + 173.58,
      `shoulder x=${shoulder.x.toFixed(2)} is inside the text edge 383.57`,
    );
  });

  it('holds across a seeded sweep of line-width patterns, with and without tails', () => {
    // Both shipping line heights, and out to the widest line a 400px panel can
    // hold — the old sweep stopped at 300px and at lineHeight 15, which is why
    // the cap-shoulder shortfall above lived here unnoticed.
    for (const lineHeight of [APP_LINE_HEIGHT, DEMO_LINE_HEIGHT]) {
      const rand = createRandom(20260806);
      for (let trial = 0; trial < 500; trial++) {
        const n = 1 + Math.floor(rand() * 5);
        const widest = 60 + rand() * 320;
        const widths = Array.from({ length: n }, () => Math.max(10, widest * (0.25 + 0.75 * rand())));
        widths[Math.floor(rand() * n)] = widest;
        // Vary the centre so the outline is never measured only on whole pixels.
        const overflow = splineOverflow(widths, trial % 2 === 0, lineHeight, 200 + rand());
        assert.ok(
          overflow <= 0.5,
          `text outside outline by ${overflow.toFixed(1)}px at lineHeight ${lineHeight} for widths [${widths.map((w) => w.toFixed(0)).join(', ')}]`,
        );
      }
    }
  });

  it('keeps every line of a shout inside the starburst', () => {
    // Regression: valleys on the box's inscribed ellipse clipped the corner
    // glyphs of every multi-line shout — a rectangle's corners lie outside its
    // inscribed ellipse. Valleys now follow the rectangle itself.
    for (const lineHeight of [APP_LINE_HEIGHT, DEMO_LINE_HEIGHT]) {
      const margin = marginFor(lineHeight);
      const rand = createRandom(96);
      for (let trial = 0; trial < 300; trial++) {
        const n = 1 + Math.floor(rand() * 4);
        const widest = 60 + rand() * 320;
        const widths = Array.from({ length: n }, () => Math.max(10, widest * (0.25 + 0.75 * rand())));
        widths[Math.floor(rand() * n)] = widest;

        const w = Math.max(...widths) + margin * 2;
        const h = n * lineHeight + margin * 2;
        const poly = starburstPoints(0, 0, w, h);
        const overflow = worstOverflow(poly, widths, w / 2, (h - n * lineHeight) / 2, lineHeight);
        assert.ok(
          overflow <= 0.5,
          `shout text outside starburst by ${overflow.toFixed(1)}px at lineHeight ${lineHeight} for widths [${widths.map((v) => v.toFixed(0)).join(', ')}]`,
        );
      }
    }
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
