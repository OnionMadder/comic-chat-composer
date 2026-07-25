/**
 * Balloon layout: routing channels, horizontal placement, vertical placement
 * and tail routing (§5.2 and §5.4).
 *
 * This is the most detailed algorithm in the paper and the heart of the
 * library. A summary of what it does and why:
 *
 * All balloon bodies sit above the tallest character's head, in a rectangle at
 * the top of the panel. Three constraints shape their placement:
 *
 *  1. Reading order is positional: top-down, then left-to-right at equal
 *     height. Since Comic Chat must convey the order utterances were made in,
 *     this constraint is strict.
 *  2. Some part of each balloon must float over the horizontal centre of its
 *     speaker's face.
 *  3. Every balloon needs somewhere to put its tail without that tail crossing
 *     another balloon or tail.
 *
 * Constraint 3 is what motivates *routing channels*. Each balloon owns a
 * horizontal interval — its channel — reserved for its tail. Channels are
 * disjoint: they partition the space available for routing tails. As each new
 * balloon body is placed it trims its own candidate channel so earlier
 * channels stay wide enough to hold a tail, and then shrinks earlier channels
 * so they no longer overlap its own.
 *
 * Bodies are placed greedily (fast, and there is no need to pack a panel as
 * tightly as possible — cartoonists do not). Tails are deferred until every
 * body is placed, because the paper reports that placing tails greedily gave
 * poor results.
 */

import type { FontMetrics } from './text.ts';
import {
  measuredBlockWidth,
  splitIntoBalloonChunks,
  widestWordWidth,
  wrapText,
} from './text.ts';
import { randomBetween, type Random } from './rng.ts';
import type { BalloonKind, BalloonTail } from './types.ts';

/** A closed horizontal interval `[l, r]`. */
export interface Interval {
  l: number;
  r: number;
}

const width = (i: Interval): number => i.r - i.l;

/** One utterance awaiting layout. */
export interface BalloonRequest {
  speaker: string;
  text: string;
  kind: BalloonKind;
  /** Horizontal centre of the speaker's face, in panel coordinates. */
  speakerX: number;
  /** Set when this request is a fragment of a split utterance. */
  continued?: boolean;
}

/** A balloon with final geometry. */
export interface LaidOutBalloon {
  request: BalloonRequest;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** The interval reserved for this balloon's tail. */
  channel: Interval;
  tail: BalloonTail | null;
  readingOrder: number;
}

export interface BalloonLayoutOptions {
  panelWidth: number;
  /** Vertical band the balloons must fit inside. */
  region: { top: number; bottom: number };
  metrics: FontMetrics;
  /** Minimum width a channel must keep for its tail — the paper's `t`. */
  minTailChannelWidth: number;
  rand: Random;
  /** Margin between text and balloon outline (§5.3). Defaults to 0.6 line heights. */
  padding?: number;
  /**
   * A single line narrower than this is never broken across lines (§5.2:
   * "if the line is short, it should not be broken"). Defaults to 40% of the
   * panel width.
   */
  shortLineWidth?: number;
}

export interface BalloonLayoutResult {
  balloons: LaidOutBalloon[];
  /**
   * How many of the supplied requests were placed. When this is less than
   * `requests.length` the caller must close the panel and retry the remainder
   * in a fresh one — this is the paper's primary panel-break trigger.
   */
  placedCount: number;
}

/**
 * Trim candidate channel `Rj` just enough that `Ri` keeps at least `t` width
 * for its own tail and stays clear of its own speaker `xi` (§5.2,
 * `MaxAllowable`).
 *
 * The paper's pseudocode assigns `R.l := max{Ri.l + t, xi}` outright, which can
 * *widen* `Rj` when that value falls left of `Rj.l` — and the surrounding prose
 * says the operation only ever trims. The fix is to fold that bound in
 * monotonically, `max(Rj.l, max(Ri.l + t, xi))`, so it can only ever raise
 * `Rj.l`. The inner operator stays the paper's `max`; the original Comic Chat
 * source (`balloon.cpp`'s `QueryRoute`, transcribed in remsky/comic-chat-web)
 * confirms both the `max(Ri.l + t, xi)` bound and that `Rj` is pushed clear of
 * the prior speaker. `test/balloons-crosscheck.test.ts` pins this against a
 * port of that routine.
 */
export function maxAllowable(
  Ri: Interval,
  xi: number,
  Rj: Interval,
  xj: number,
  t: number,
): Interval {
  if (xi < xj) {
    return { l: Math.max(Rj.l, Math.max(Ri.l + t, xi)), r: Rj.r };
  }
  return { l: Rj.l, r: Math.min(Rj.r, Math.min(Ri.r - t, xi)) };
}

/**
 * Shrink channel `Ri` so it no longer overlaps the newly committed `Rj`
 * (§5.2, `ReduceChannel`). Channels are disjoint by construction after this.
 *
 * Deviation from the paper: the published pseudocode copies `Ri` into `R`,
 * mutates `Ri`, then returns `R` — an inconsistency. The evident intent is to
 * return the reduced interval, which is what happens here.
 */
export function reduceChannel(Ri: Interval, xi: number, Rj: Interval, xj: number): Interval {
  if (xi < xj) return { l: Ri.l, r: Math.min(Ri.r, Rj.l) };
  return { l: Math.max(Ri.l, Rj.r), r: Ri.r };
}

/**
 * Choose a target width for a balloon (§5.2).
 *
 * Estimate the area the body will cover from the area of a single typeset
 * line, scaled up by a third to account for line breaks and leading. Short
 * lines are left unbroken. Otherwise the minimum allowable width is the wider
 * of the widest single word and `area / allowableHeight`, and the target is
 * drawn randomly between that minimum and the panel width.
 */
function findWidth(
  text: string,
  allowableHeight: number,
  options: BalloonLayoutOptions,
  padding: number,
): number {
  const { metrics, panelWidth, rand } = options;
  const shortLineWidth = options.shortLineWidth ?? panelWidth * 0.4;

  const singleLine = metrics.measure(text);
  if (singleLine <= shortLineWidth) return singleLine + padding * 2;

  const area = singleLine * metrics.lineHeight * (4 / 3);
  const byArea = allowableHeight > 0 ? area / allowableHeight : panelWidth;
  const minWidth = Math.max(widestWordWidth(text, metrics), byArea) + padding * 2;

  return randomBetween(rand, Math.min(minWidth, panelWidth), panelWidth);
}

interface Body {
  l: number;
  r: number;
  lines: string[];
  height: number;
}

/** Lay text out at a given body width, returning lines and resulting height. */
function typeset(
  text: string,
  bodyWidth: number,
  metrics: FontMetrics,
  padding: number,
): { lines: string[]; height: number } {
  const lines = wrapText(text, Math.max(1, bodyWidth - padding * 2), metrics);
  const height = Math.max(1, lines.length) * metrics.lineHeight + padding * 2;
  return { lines, height };
}

/**
 * Place a balloon of width `w` inside channel `R`, keeping it over `speakerX`
 * (§5.2 `Position` — the horizontal offset within the channel is random).
 */
function position(R: Interval, w: number, speakerX: number, rand: Random): { l: number; r: number } {
  // The balloon must cover the speaker's face centre, so its left edge lies in
  // [speakerX - w, speakerX]; it must also sit inside the channel.
  const lo = Math.max(R.l, speakerX - w);
  const hi = Math.min(R.r - w, speakerX);
  if (hi < lo) {
    // Cannot satisfy both; prefer staying inside the channel.
    const l = Math.max(R.l, Math.min(R.r - w, speakerX - w / 2));
    return { l, r: l + w };
  }
  const l = randomBetween(rand, lo, hi);
  return { l, r: l + w };
}

/**
 * Try to fit the text into a channel narrower than the target width
 * (§5.2 `SqueezeBalloon`). Fails when the text cannot be made to fit at all.
 */
function squeezeBalloon(
  R: Interval,
  text: string,
  allowableHeight: number,
  options: BalloonLayoutOptions,
  padding: number,
): { lines: string[]; height: number } | null {
  const { metrics } = options;
  const available = width(R);
  if (available <= padding * 2) return null;
  if (widestWordWidth(text, metrics) > available - padding * 2) return null;

  const { lines, height } = typeset(text, available, metrics, padding);
  if (height > allowableHeight) return null;
  return { lines, height };
}

/**
 * Lay out a panel's balloons.
 *
 * Runs the paper's `PlaceBalloons` for horizontal placement and channel
 * allocation, then a vertical pass that pushes each balloon as high as reading
 * order allows, then routes the tails.
 *
 * @returns The balloons that fit, and how many of the requests were consumed.
 *   A `placedCount` below `requests.length` means the panel is full.
 */
export function layoutBalloons(
  requests: readonly BalloonRequest[],
  options: BalloonLayoutOptions,
): BalloonLayoutResult {
  const { metrics, region, minTailChannelWidth: t, panelWidth } = options;
  const padding = options.padding ?? metrics.lineHeight * 0.6;

  const channels: Interval[] = [];
  const bodies: Body[] = [];
  const speakerXs: number[] = [];

  // ---- Horizontal placement (PlaceBalloons) -----------------------------
  let stackedBottom = region.top;

  for (let j = 0; j < requests.length; j++) {
    const req = requests[j]!;
    const xj = req.speakerX;

    // Conservative allowable height: from the bottom of the lowest balloon
    // placed so far down to the bottom of the balloon rectangle.
    const allowableHeight = region.bottom - stackedBottom;
    if (allowableHeight <= 0) return finish(j);

    const wj = Math.min(findWidth(req.text, allowableHeight, options, padding), panelWidth);

    let Rj: Interval = {
      l: Math.max(0, xj - wj),
      r: Math.min(panelWidth, xj + wj),
    };

    for (let i = 0; i < j; i++) {
      Rj = maxAllowable(channels[i]!, speakerXs[i]!, Rj, xj, t);
    }

    let body: Body;
    if (width(Rj) >= wj) {
      const span = position(Rj, wj, xj, options.rand);
      const { lines, height } = typeset(req.text, wj, metrics, padding);
      if (height > allowableHeight) {
        // Target width was wide enough horizontally but the text still runs
        // past the bottom of the balloon region.
        const squeezed = squeezeBalloon(Rj, req.text, allowableHeight, options, padding);
        if (!squeezed) return finish(j);
        body = { l: Rj.l, r: Rj.r, lines: squeezed.lines, height: squeezed.height };
      } else {
        body = { l: span.l, r: span.r, lines, height };
      }
    } else {
      const squeezed = squeezeBalloon(Rj, req.text, allowableHeight, options, padding);
      if (!squeezed) return finish(j);
      body = { l: Rj.l, r: Rj.r, lines: squeezed.lines, height: squeezed.height };
    }

    // The committed channel is the balloon's horizontal extent.
    const committed: Interval = { l: body.l, r: body.r };

    for (let i = 0; i < j; i++) {
      channels[i] = reduceChannel(channels[i]!, speakerXs[i]!, committed, xj);
    }

    channels.push(committed);
    bodies.push(body);
    speakerXs.push(xj);
    stackedBottom += body.height;
  }

  return finish(requests.length);

  // ---- Vertical placement, tails, reading order -------------------------
  function finish(placedCount: number): BalloonLayoutResult {
    const n = placedCount;
    if (n === 0) return { balloons: [], placedCount: 0 };

    const tops: number[] = [];
    for (let j = 0; j < n; j++) {
      const bj = bodies[j]!;
      const centerJ = (bj.l + bj.r) / 2;
      let top = region.top;

      // Reading order: no higher than the bottom of any balloon already placed
      // to the right, and no higher than the top of any placed to the left.
      //
      // The "to the left" case permits equal height, which is only safe while
      // the two bodies are horizontally disjoint. Routing channels are a
      // partition of the space reserved for *tails* — they do not stop two
      // bodies from overlapping, since a body may legitimately extend over a
      // neighbour's channel. So a balloon that overlaps horizontally must clear
      // the other outright, which also keeps it later in the reading order.
      for (let i = 0; i < j; i++) {
        const bi = bodies[i]!;
        const centerI = (bi.l + bi.r) / 2;
        const overlapsHorizontally = bi.l < bj.r && bj.l < bi.r;
        if (overlapsHorizontally || centerI > centerJ) {
          top = Math.max(top, tops[i]! + bi.height);
        } else {
          top = Math.max(top, tops[i]!);
        }
      }

      if (top + bj.height > region.bottom) {
        // Ran out of vertical room; everything from here needs a new panel.
        return assemble(j);
      }
      tops.push(top);
    }

    return assemble(n);

    function assemble(count: number): BalloonLayoutResult {
      if (count === 0) return { balloons: [], placedCount: 0 };

      const lowestBottom = Math.max(
        ...Array.from({ length: count }, (_, i) => tops[i]! + bodies[i]!.height),
      );

      // Tails all come to a point at roughly the same height, below the lowest
      // balloon and within the lowest third of the balloon region (§5.4).
      //
      // Those are both lower bounds, so the tip is taken all the way down to
      // the bottom of the balloon region — which is exactly the line above the
      // tallest character's head. Stopping at the lowest-third bound instead
      // leaves the tail hanging in mid-air well short of the speaker.
      const regionHeight = region.bottom - region.top;
      const tipY = Math.max(
        region.bottom,
        lowestBottom + metrics.lineHeight * 0.5,
        region.top + regionHeight * (2 / 3),
      );

      const laid: LaidOutBalloon[] = [];
      for (let j = 0; j < count; j++) {
        const body = bodies[j]!;
        const req = requests[j]!;
        const channel = channels[j]!;
        const top = tops[j]!;
        const bottom = top + body.height;

        laid.push({
          request: req,
          lines: body.lines,
          x: body.l,
          y: top,
          width: body.r - body.l,
          height: body.height,
          channel,
          tail:
            req.kind === 'narration'
              ? null
              : routeTail(body, channel, req.speakerX, bottom, tipY, metrics, options),
          readingOrder: 0,
        });
      }

      // Reading order: top-down, then left-to-right at equal height.
      const order = laid
        .map((b, i) => ({ i, y: b.y, x: b.x }))
        .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
      order.forEach((entry, rank) => {
        laid[entry.i]!.readingOrder = rank;
      });

      return { balloons: laid, placedCount: count };
    }
  }
}

/**
 * Route one balloon's tail (§5.4).
 *
 * The tail leaves the balloon from under the bottom line of text where
 * possible, staying clear of the channel edges so it does not run flush
 * against a neighbouring balloon or tail. Failing that it attaches within the
 * channel at a small horizontal offset from the speaker's head, which gives
 * the tail a definite arc without sweeping diagonally across the panel.
 */
function routeTail(
  body: Body,
  channel: Interval,
  speakerX: number,
  bodyBottom: number,
  tipY: number,
  metrics: FontMetrics,
  options: BalloonLayoutOptions,
): BalloonTail {
  const edgeMargin = Math.min(options.minTailChannelWidth / 2, width(channel) / 4);

  const lastLine = body.lines[body.lines.length - 1] ?? '';
  const lastLineWidth = measuredBlockWidth([lastLine], metrics);
  const bodyCenter = (body.l + body.r) / 2;
  const lastLineSpan: Interval = {
    l: bodyCenter - lastLineWidth / 2,
    r: bodyCenter + lastLineWidth / 2,
  };

  // Where the last line of text and the routing channel overlap.
  const overlap: Interval = {
    l: Math.max(lastLineSpan.l, channel.l + edgeMargin),
    r: Math.min(lastLineSpan.r, channel.r - edgeMargin),
  };

  let fromX: number;
  if (width(overlap) >= edgeMargin) {
    // A large enough part of the last line spans the channel.
    fromX = randomBetween(options.rand, overlap.l, overlap.r);
  } else {
    // Fall back: attach inside the channel, slightly offset from the speaker.
    const offset = metrics.lineHeight * 0.75;
    const preferred = speakerX < bodyCenter ? speakerX + offset : speakerX - offset;
    fromX = Math.min(
      Math.max(preferred, channel.l + edgeMargin),
      Math.max(channel.l + edgeMargin, channel.r - edgeMargin),
    );
  }

  return {
    fromX,
    fromY: bodyBottom,
    toX: speakerX,
    toY: Math.max(tipY, bodyBottom),
    // Tails starting left of the speaker curve counterclockwise; right, clockwise.
    curve: fromX < speakerX ? 'ccw' : 'cw',
  };
}

/**
 * Split an utterance that cannot fit a panel on its own into fragments that
 * can, joined by ellipses (§5.2).
 *
 * @returns One string per balloon. A single-element array means no split was
 *   necessary.
 */
export function splitOversizedText(
  text: string,
  options: BalloonLayoutOptions,
): string[] {
  const { metrics, region, panelWidth } = options;
  const padding = options.padding ?? metrics.lineHeight * 0.6;
  const usableWidth = Math.max(1, panelWidth - padding * 2);
  const maxLines = Math.max(1, Math.floor((region.bottom - region.top - padding * 2) / metrics.lineHeight));

  if (wrapText(text, usableWidth, metrics).length <= maxLines) return [text];
  return splitIntoBalloonChunks(text, usableWidth, maxLines, metrics);
}
