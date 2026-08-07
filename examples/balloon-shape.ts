/**
 * Balloon body construction — §5.3.
 *
 * Balloons flow *around* their text rather than boxing it. The outline is a
 * closed cubic B-spline through control points derived from the width of each
 * typeset line, expanded outward by a margin.
 *
 * The paper is unusually specific about what makes this look hand-drawn rather
 * than generated, and all four rules are implemented here:
 *
 *  1. **Margin.** Line boundaries are expanded outward before splining, because
 *     comic artists always leave space between text and outline.
 *  2. **No inward dip.** The outline never pinches in on one line only to bulge
 *     back out on the next. Their first attempt "appeared amoeba-like,
 *     following the text too closely, responding to its every turn."
 *  3. **Ignore small changes.** The outline shifts only in response to *large*
 *     changes in the text outline, not every few pixels of difference.
 *  4. **Low-frequency perturbation.** Long stretches of outline that don't bend
 *     with the text get extra control points nudged alternately toward and away
 *     from the text. The paper singles this out as the last remaining gap
 *     between their output and Jim Woodring's hand-drawn originals.
 *
 * Tails are spliced into the same closed spline rather than drawn as a separate
 * shape, so body and tail share one continuous outline with no seam. The tip is
 * given control-point multiplicity 3, which forces a cubic B-spline to
 * interpolate it exactly and produce a sharp corner there.
 *
 * This lives in `examples/` because §5.3 is balloon *construction*, downstream
 * of the composer's job. Promote it into `src/` if a renderer ever needs it as
 * package API.
 */

import type { BalloonTail } from '../src/types.ts';

export interface Point {
  x: number;
  y: number;
}

export interface BalloonShapeOptions {
  /** Measured width of each typeset line, top to bottom. */
  lineWidths: readonly number[];
  /** Horizontal centre of the text block — text is centred (§5.3). */
  centreX: number;
  /** Top of the first line's box. */
  textTop: number;
  lineHeight: number;
  /** Space between text and outline. */
  margin: number;
  /**
   * B-spline tension. The paper uses 5.0 to get "moderately sharp bends".
   *
   * It does not say what scale that 5.0 is on — presumably their own spline
   * library's — so it is mapped here as `t / (t + 5)`, a smooth 0→1 ramp that
   * puts the paper's stated value at exactly 0.5. 0 is a pure uniform B-spline
   * (loosest, hugs nothing); 1 collapses onto the control polygon.
   */
  tension?: number;
  /** Outline shifts smaller than this are ignored (rule 3). Default: one margin. */
  minShift?: number;
  /** How many equal-width lines count as a "long segment" (rule 4). Default 3. */
  perturbationRun?: number;
  /** Amplitude of the low-frequency waves (rule 4). Default: 0.35 × margin. */
  perturbationAmplitude?: number;
  /** Tail to splice into the outline, or null for none. */
  tail?: BalloonTail | null;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

/**
 * Apply the paper's two anti-amoeba rules to the per-line half-widths.
 *
 * @returns Half-widths with single-line dips filled in and small shifts flattened.
 */
export function smoothHalfWidths(
  halfWidths: readonly number[],
  minShift: number,
): number[] {
  const out = [...halfWidths];

  // Rule 2 — never dip inward on one line just to move outward again on the
  // next. A line narrower than both its neighbours is raised to the smaller of
  // them, so the outline stays put instead of pinching.
  for (let i = 1; i < out.length - 1; i++) {
    const dip = Math.min(out[i - 1]!, out[i + 1]!);
    if (out[i]! < dip) out[i] = dip;
  }

  // Rule 3 — respond only to larger changes. Walk top to bottom holding the
  // current outline position until the text demands a big enough move.
  let held = out[0]!;
  for (let i = 1; i < out.length; i++) {
    if (Math.abs(out[i]! - held) < minShift) out[i] = held;
    else held = out[i]!;
  }

  // The hold above can flatten a *wider* line down to an earlier, narrower
  // width. The difference is small by construction, but glyphs still reach the
  // line's own width, so a held-down line loses that much of its margin and
  // pokes through the outline once the spline sags between knots. Raise each
  // flat run to the widest requirement inside it: the run stays flat — the
  // point of rule 3 — and every line keeps its full margin.
  let runStart = 0;
  for (let i = 1; i <= out.length; i++) {
    if (i < out.length && out[i] === out[runStart]) continue;
    let runMax = out[runStart]!;
    for (let j = runStart; j < i; j++) runMax = Math.max(runMax, halfWidths[j]!);
    for (let j = runStart; j < i; j++) out[j] = runMax;
    runStart = i;
  }

  return out;
}

/**
 * Build the control polygon for the balloon outline.
 *
 * Walks the top cap, down the right side, across the bottom (splicing the tail
 * if there is one), and back up the left side. Text is centred, so the two
 * sides mirror each other apart from perturbation.
 */
export function balloonControlPoints(options: BalloonShapeOptions): Point[] {
  const {
    lineWidths,
    centreX,
    textTop,
    lineHeight,
    margin,
    tail = null,
  } = options;

  const minShift = options.minShift ?? margin;
  const runLength = options.perturbationRun ?? 3;
  const amplitude = options.perturbationAmplitude ?? margin * 0.35;

  const n = Math.max(1, lineWidths.length);
  const raw = Array.from({ length: n }, (_, i) => (lineWidths[i] ?? 0) / 2 + margin);
  const half = smoothHalfWidths(raw, minShift);

  const lineY = (i: number): number => textTop + (i + 0.5) * lineHeight;
  const topY = textTop - margin;
  const bottomY = textTop + n * lineHeight + margin;
  const lastHalf = half[n - 1]!;

  // Rule 4 — find runs of lines whose outline doesn't move, and mark where to
  // insert the low-frequency waves.
  const perturbAfter = new Set<number>();
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && half[i] === half[i - 1]) continue;
    if (i - runStart >= runLength) {
      for (let j = runStart; j < i - 1; j++) perturbAfter.add(j);
    }
    runStart = i;
  }

  let wave = 0;
  const nextWave = (): number => (wave++ % 2 === 0 ? 1 : -1);

  // Caps get shoulders rather than coming to a single point at the centre.
  // A pointed cap puts the widest line of text immediately next to a very
  // narrow neighbour, and the correction needed to pull the curve back out to
  // the text then shows up as a spike on the side of the balloon.
  // The cap shoulder sits close to the first/last line's width, not far inside
  // it: a shoulder much narrower than the widest line forces a near-horizontal
  // jump out to that line over a short vertical gap, which the fitting then
  // amplifies into a spike off the side of the balloon.
  // The shoulder inset is capped in absolute terms, not proportional to the
  // line: the shoulder sits barely above the line's glyph tops, so an inset
  // that grows with the line's width eventually reaches in past the corner
  // glyphs of any sufficiently wide line and the outline cuts them off.
  const capInset = margin * 0.9;
  const shoulderFor = (h: number): number => h - Math.min(h * 0.12, margin * 0.6);
  const topShoulder = shoulderFor(half[0]!);
  const bottomShoulder = shoulderFor(lastHalf);

  const points: Point[] = [
    { x: centreX, y: topY },
    { x: centreX + topShoulder, y: topY + capInset },
  ];

  // One side of the balloon, `dir` being +1 for the right and -1 for the left.
  //
  // A point per line is too coarse on its own: a wide line directly above a
  // short one makes the contour turn a hard corner, which shows as a spike once
  // the control points are fitted. Sampling a midpoint between each pair of
  // lines gives the curve room to ramp between the two widths instead. Those
  // same midpoints carry the §5.3 perturbation where a run is long enough.
  const side = (dir: 1 | -1): void => {
    const order = dir === 1 ? [...half.keys()] : [...half.keys()].reverse();
    for (let k = 0; k < order.length; k++) {
      const i = order[k]!;
      points.push({ x: centreX + dir * half[i]!, y: lineY(i) });

      const j = order[k + 1];
      if (j === undefined) continue;

      const between = Math.min(i, j);
      // The midpoint sits at the boundary between the two lines — exactly the
      // height of the wider line's corner glyphs, which reach its full
      // half-width. A midpoint at the plain mean passes inside that corner
      // whenever the widths differ by more than two margins, so it is floored
      // to keep at least half a margin clear of the wider line. When the
      // widths are close (which smoothing has already flattened), the mean
      // wins and the ramp is as gentle as before.
      const mean = (half[i]! + half[j]!) / 2;
      const cleared = Math.max(mean, Math.max(half[i]!, half[j]!) - margin * 0.5);
      const offset = perturbAfter.has(between) ? nextWave() * amplitude : 0;
      points.push({
        x: centreX + dir * (cleared + offset),
        y: (lineY(i) + lineY(j)) / 2,
      });
    }
  };

  side(1);

  if (tail) {
    // The bottom edge runs right to left: shoulder, mouth, taper, tip, taper,
    // mouth, shoulder. The mouth — not the tail's requested x — is what has to
    // stay inside the shoulders, or the outline doubles back on itself and the
    // spline kinks. So the clamp has to leave room for the mouth's half-width.
    // Like the caps, the shoulder inset is capped in absolute terms: on a wide
    // last line a proportional inset reaches past the corner glyphs and the
    // outline cuts the line's ends off on its way to the tail mouth.
    const shoulder = lastHalf - Math.min(lastHalf * 0.2, margin * 0.75);
    const mouth = Math.min(Math.max(lastHalf * 0.28, 7), 16);
    const reach = Math.max(0, shoulder - mouth);
    const fromX = Math.min(Math.max(tail.fromX, centreX - reach), centreX + reach);
    const tip: Point = { x: tail.toX, y: tail.toY };

    // Without a waypoint partway down, the spline sweeps from the full mouth
    // straight to the tip and the tail reads as a cone. A narrowed pair of
    // points at the midpoint makes it taper, and offsetting them along the
    // perpendicular gives the tail the arc §5.4 asks for — counterclockwise
    // when it starts left of the speaker, clockwise when it starts right. The
    // two sides must stay far enough apart at the midpoint that the tail reads
    // as a solid shape rather than a doubled line.
    const dx = tip.x - fromX;
    const dy = tip.y - bottomY;
    const len = Math.hypot(dx, dy) || 1;
    const bow = (tail.curve === 'ccw' ? -1 : 1) * Math.min(16, len * 0.2);
    const perpX = (-dy / len) * bow;
    const perpY = (dx / len) * bow;
    const midX = fromX + dx * 0.55 + perpX;
    const midY = bottomY + dy * 0.55 + perpY;
    const taper = Math.max(mouth * 0.6, 4);

    points.push({ x: centreX + shoulder, y: bottomY });
    points.push({ x: fromX + mouth, y: bottomY });
    points.push({ x: midX + taper, y: midY });
    // Multiplicity 3 forces the spline through the tip with a sharp corner.
    points.push(tip, tip, tip);
    points.push({ x: midX - taper, y: midY });
    points.push({ x: fromX - mouth, y: bottomY });
    points.push({ x: centreX - shoulder, y: bottomY });
  } else {
    points.push({ x: centreX + bottomShoulder, y: bottomY - capInset });
    points.push({ x: centreX, y: bottomY });
    points.push({ x: centreX - bottomShoulder, y: bottomY - capInset });
  }

  side(-1);

  points.push({ x: centreX - topShoulder, y: topY + capInset });

  return points;
}

/**
 * Convert a closed control polygon to a cubic Bézier path.
 *
 * Uses the standard uniform cubic B-spline to Bézier conversion, then blends
 * the result toward the control polygon by the tension factor.
 */
export function splineToPath(points: readonly Point[], tension: number): string {
  const n = points.length;
  if (n < 3) return '';

  const at = (i: number): Point => points[((i % n) + n) % n]!;
  const t = tension / (tension + 5);

  const segments: string[] = [];
  let start: Point | null = null;

  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    // Uniform cubic B-spline segment as a Bézier.
    let b0: Point = { x: (p0.x + 4 * p1.x + p2.x) / 6, y: (p0.y + 4 * p1.y + p2.y) / 6 };
    let b1: Point = { x: (2 * p1.x + p2.x) / 3, y: (2 * p1.y + p2.y) / 3 };
    let b2: Point = { x: (p1.x + 2 * p2.x) / 3, y: (p1.y + 2 * p2.y) / 3 };
    let b3: Point = { x: (p1.x + 4 * p2.x + p3.x) / 6, y: (p1.y + 4 * p2.y + p3.y) / 6 };

    // Tension pulls the curve toward the control polygon; at t = 1 the segment
    // is exactly the straight edge p1→p2.
    if (t > 0) {
      b0 = lerpPoint(b0, p1, t);
      b3 = lerpPoint(b3, p2, t);
      b1 = lerpPoint(b1, lerpPoint(p1, p2, 1 / 3), t);
      b2 = lerpPoint(b2, lerpPoint(p1, p2, 2 / 3), t);
    }

    if (!start) {
      start = b0;
      segments.push(`M ${b0.x.toFixed(2)} ${b0.y.toFixed(2)}`);
    }
    segments.push(
      `C ${b1.x.toFixed(2)} ${b1.y.toFixed(2)} ${b2.x.toFixed(2)} ${b2.y.toFixed(2)} ${b3.x.toFixed(2)} ${b3.y.toFixed(2)}`,
    );
  }

  segments.push('Z');
  return segments.join(' ');
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/**
 * Solve for control points whose *curve* passes through `targets`.
 *
 * A B-spline is approximating, not interpolating — it does not pass through its
 * own control points. Feeding the balloon boundary in directly therefore yields
 * an outline noticeably tighter than intended: the widest line of text sits
 * between a narrow top cap and a narrower line below, so the curve gets pulled
 * inward and the text spills outside the balloon drawn to hold it.
 *
 * This corrects for that by iterative refinement — evaluate where the curve
 * actually lands at each knot, push the control point by the shortfall, repeat.
 * It converges in a handful of passes and avoids solving the cyclic tridiagonal
 * system directly.
 *
 * Points repeated for multiplicity (the tail tip) are pinned: the spline already
 * interpolates them exactly, and nudging them would round off the sharp corner
 * the repetition exists to create.
 */
export function fitControlPoints(
  targets: readonly Point[],
  tension: number,
  iterations = 8,
): Point[] {
  const n = targets.length;
  if (n < 3) return targets.map((p) => ({ ...p }));

  const t = tension / (tension + 5);
  const points = targets.map((p) => ({ ...p }));
  const idx = (i: number): number => ((i % n) + n) % n;

  const pinned = targets.map(
    (p, i) => samePoint(p, targets[idx(i - 1)]!) || samePoint(p, targets[idx(i + 1)]!),
  );

  // Fitting is allowed to push control points outside the target polygon, but
  // only so far, so a control point next to a sharp contour change can never
  // spur out into a spike. Pinned points (the tail tip) are excluded — they may
  // sit well below the body and define the extent themselves.
  //
  // The bound has to be the extent of the *solution*, not of the targets. A
  // B-spline is approximating, so interpolating a knot always means placing its
  // control point outside the knot; a knot at the polygon's own extremum —
  // which is exactly what a cap shoulder is — therefore needs a control point
  // beyond that extremum. Bounding by the targets plus a flat few pixels made
  // the clamp bind on precisely those points, and the curve fell short of the
  // boundary it was being fitted to: on a wide single-line balloon the top
  // shoulder came back ~7px inside its target, inside the text it was drawn to
  // clear. Solving one Jacobi pass of the same knot equation gives a
  // first-order estimate of where the control points have to live, which is a
  // bound that admits the legitimate overshoot while still refusing a spike.
  //
  // knot_i = neighbourWeight·(p_{i-1} + p_{i+1}) + selfWeight·p_i, the two
  // weights summing to 1, so inverting for p_i against the targets' own
  // neighbours is one multiply per point.
  const neighbourWeight = (1 - t) / 6;
  const selfWeight = (2 + t) / 3;
  const required = targets.map((p, i) => {
    const prev = targets[idx(i - 1)]!;
    const next = targets[idx(i + 1)]!;
    return {
      x: (p.x - neighbourWeight * (prev.x + next.x)) / selfWeight,
      y: (p.y - neighbourWeight * (prev.y + next.y)) / selfWeight,
    };
  });
  const bounding = [...targets, ...required].filter((_, i) => !pinned[i % n]);
  const freeXs = bounding.map((p) => p.x);
  const freeYs = bounding.map((p) => p.y);
  const slack = 4;
  const minX = Math.min(...freeXs) - slack;
  const maxX = Math.max(...freeXs) + slack;
  const minY = Math.min(...freeYs) - slack;
  const maxY = Math.max(...freeYs) + slack;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

  for (let pass = 0; pass < iterations; pass++) {
    // Where the curve currently lands at each knot.
    const actual = points.map((_, i) => {
      const a = points[idx(i - 1)]!;
      const b = points[i]!;
      const c = points[idx(i + 1)]!;
      const spline = { x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 };
      return lerpPoint(spline, b, t);
    });

    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const dx = targets[i]!.x - actual[i]!.x;
      const dy = targets[i]!.y - actual[i]!.y;
      // Cap each step. A uniform B-spline needs at most a 6× push to interpolate
      // a knot, but an unbounded correction next to a sharp contour change
      // throws the control point far out and the curve spikes. Half the spacing
      // between neighbouring targets is a safe, geometry-relative ceiling.
      const prev = targets[idx(i - 1)]!;
      const next = targets[idx(i + 1)]!;
      const span = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      const step = Math.hypot(dx, dy);
      const cap = span * 0.75;
      const k = step > cap ? cap / step : 1;
      points[i]!.x = clamp(points[i]!.x + dx * k, minX, maxX);
      points[i]!.y = clamp(points[i]!.y + dy * k, minY, maxY);
    }
  }

  return points;
}

/**
 * Starburst outline for shout balloons (§5.1), as a closed point polygon.
 *
 * Valleys sit on the balloon box's own perimeter and the spikes radiate
 * outward from it, with a spike pinned at every corner. The corner spikes are
 * load-bearing: the text fills the box's *rectangle*, so any chord that
 * shortcuts a corner cuts across glyphs. (An earlier construction placed the
 * valleys on the box's inscribed ellipse, which clipped the corner glyphs of
 * every multi-line shout — a rectangle's corners lie outside its inscribed
 * ellipse.)
 */
export function starburstPoints(x: number, y: number, w: number, h: number): Point[] {
  const amp = Math.max(6, Math.min(12, Math.min(w, h) * 0.18));
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Corners clockwise from top-left; each edge runs corner to corner.
  const corners: Point[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];

  const pts: Point[] = [];
  for (let e = 0; e < 4; e++) {
    const c0 = corners[e]!;
    const c1 = corners[(e + 1) % 4]!;
    const ex = c1.x - c0.x;
    const ey = c1.y - c0.y;
    const len = Math.hypot(ex, ey);
    // Outward edge normal (perimeter is walked clockwise in y-down space).
    const nx = ey / len;
    const ny = -ex / len;

    // Corner spike, out along the diagonal.
    const diag = Math.SQRT1_2 * amp * 1.2;
    pts.push({
      x: c0.x + Math.sign(c0.x - cx) * diag,
      y: c0.y + Math.sign(c0.y - cy) * diag,
    });

    // Alternate valley (on the edge) and spike (off it) along the edge.
    const valleys = Math.max(1, Math.round(len / 34));
    for (let i = 0; i < valleys; i++) {
      pts.push({ x: c0.x + ex * ((i + 0.5) / valleys), y: c0.y + ey * ((i + 0.5) / valleys) });
      if (i < valleys - 1) {
        const t = (i + 1) / valleys;
        pts.push({ x: c0.x + ex * t + nx * amp, y: c0.y + ey * t + ny * amp });
      }
    }
  }
  return pts;
}

/**
 * Build a complete balloon outline as an SVG path.
 *
 * @example
 * ```ts
 * const d = balloonOutlinePath({
 *   lineWidths: [96, 62],
 *   centreX: 200, textTop: 20, lineHeight: 15, margin: 9,
 *   tail: { fromX: 190, fromY: 62, toX: 170, toY: 150, curve: 'ccw' },
 * });
 * ```
 */
export function balloonOutlinePath(options: BalloonShapeOptions): string {
  const tension = options.tension ?? 5;
  const targets = balloonControlPoints(options);
  return splineToPath(fitControlPoints(targets, tension), tension);
}
