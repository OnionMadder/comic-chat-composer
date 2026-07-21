/**
 * Virtual camera framing — the zoom rules of §6.2.
 *
 * "If movies and television were always shot with the same camera parameters,
 * they would quickly become visually tedious." Comic Chat varies the scale at
 * which characters and background appear, pulling in to the tightest shot the
 * following rules allow:
 *
 *  1. Never zoom so far as to cut a character at the neck — always include part
 *     of the shoulders.
 *  2. Never let a *required* character (one the composer decided must appear) be
 *     cut off by the sides of the panel.
 *  3. Never cut a character at the ankles — pull back and show them whole
 *     instead. Knees are allowed.
 *
 * One line matters for how this composes with the rest of the pipeline: "word
 * balloons are unaffected by the virtual zoom factor." The camera therefore
 * describes a window onto the *character and background* layer only. A renderer
 * maps that window onto the panel viewport, and draws balloons over the top in
 * unscaled panel coordinates.
 *
 * The camera is a pure function of character geometry, kept free of any
 * manifest or rendering dependency so it can be tested on its own.
 */

/** A camera: a rectangle of world space, mapped onto the full panel viewport. */
export interface Camera {
  /** Left edge of the visible window, in world (composed) coordinates. */
  x: number;
  /** Top edge of the visible window. */
  y: number;
  width: number;
  height: number;
  /**
   * Magnification: `panelWidth / width`. Greater than 1 is a close shot,
   * less than 1 pulls back to show more than the panel's worth of world.
   */
  scale: number;
}

/** One character's horizontal extent in world coordinates. */
export interface CameraCharacter {
  /** Centre of the character's face. */
  x: number;
  /** Half the character's drawn width. */
  halfWidth: number;
  /**
   * Whether this character must not be cut by the panel sides (rule 2). The
   * composer only includes characters it decided to include, so in practice
   * every character in a panel is required.
   */
  required: boolean;
}

export interface CameraOptions {
  panelWidth: number;
  panelHeight: number;
  /** Full standing height of a character, world units. */
  characterHeight: number;
  /** World y of the ground the characters stand on (their feet). */
  groundY: number;
  /**
   * Distance from the top of the head down to the shoulder line, as a fraction
   * of {@link characterHeight}. The tightest crop sits here (rule 1).
   */
  shoulderFraction: number;
  /**
   * Distance from the top of the head down to the knees, as a fraction of
   * {@link characterHeight}. A permitted crop line (rule 3 forbids the ankles,
   * not the knees).
   */
  kneeFraction: number;
  /** Force an establishing shot: pull back to show the surroundings. */
  establishing: boolean;
  /** Hard ceiling on magnification, so a solo close-up stays sane. */
  maxScale: number;
  /**
   * Screen y at which the top of a character's head sits on a close/medium
   * shot, in world units (the panel and world share a scale of 1 at the
   * viewport). Kept below the balloon region so heads read as being *under*
   * the balloons, with the tails reaching down to them. Balloons overlay in
   * screen space and are otherwise unaffected (§6.2).
   */
  headScreenY: number;
  /** Ground line for a full-body / establishing shot, world units from the top. */
  groundScreenY: number;
  /** Slack between a required character and the panel side, world units. */
  sideMargin: number;
  /** Magnification for an establishing shot (< 1 pulls back). */
  establishingScale: number;
}

/** Horizontal span that must stay on-screen: the required characters' extent. */
function requiredSpan(
  characters: readonly CameraCharacter[],
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const c of characters) {
    if (!c.required) continue;
    min = Math.min(min, c.x - c.halfWidth);
    max = Math.max(max, c.x + c.halfWidth);
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

/**
 * Choose a camera for a panel.
 *
 * The vertical framing anchors the top of the character's head to a fixed
 * screen line kept below the balloon region, and lets magnification decide how
 * far down the body the panel bottom cuts. Larger magnification means a bigger
 * character cut higher up. The bottom cut is only ever allowed to land at the
 * shoulders (tightest, rule 1), between the shoulders and the knees, or below
 * the feet (full body) — never in the ankle zone (rule 3). Whichever of those
 * gives the tightest shot that still keeps every required character within the
 * panel sides (rule 2) and stays under the magnification ceiling wins.
 *
 * When even a full-body shot can't fit the cast horizontally, or when an
 * establishing shot is forced, the camera instead anchors the feet to the
 * ground and pulls back until everything fits.
 *
 * @returns The world rectangle to show, and its magnification.
 */
export function computeCamera(
  characters: readonly CameraCharacter[],
  options: CameraOptions,
): Camera {
  const {
    panelWidth: W,
    panelHeight: H,
    characterHeight: Ch,
    groundY,
    shoulderFraction,
    kneeFraction,
    establishing,
    maxScale,
    headScreenY,
    groundScreenY,
    sideMargin,
    establishingScale,
  } = options;

  const headTop = groundY - Ch;
  const span = requiredSpan(characters);
  const spanWidth = span ? span.max - span.min : 0;

  /**
   * Build a camera at magnification `scale`, positioned so a chosen world y
   * lands on a chosen screen y, and centred horizontally on the required span.
   */
  const frame = (scale: number, anchorWorldY: number, anchorScreenY: number): Camera => {
    const width = W / scale;
    const height = H / scale;
    const top = anchorWorldY - anchorScreenY / scale;

    let left: number;
    if (span) {
      const mid = (span.min + span.max) / 2;
      left = mid - width / 2;
      if (span.min - sideMargin < left) left = span.min - sideMargin;
      if (span.max + sideMargin > left + width) left = span.max + sideMargin - width;
    } else {
      left = (W - width) / 2;
    }

    return { x: left, y: top, width, height, scale };
  };

  // The widest magnification the required characters can survive without being
  // cut by the panel sides (rule 2).
  const horizontalLimit =
    spanWidth > 0 ? (W - 2 * sideMargin) / (spanWidth + 2 * sideMargin) : Number.POSITIVE_INFINITY;

  // With the head anchored at `headScreenY`, these magnifications put each
  // landmark exactly at the panel bottom. A larger scale is a tighter shot.
  const drop = H - headScreenY;
  const shoulderScale = drop / (shoulderFraction * Ch); // tightest safe (rule 1)
  const kneeScale = drop / (kneeFraction * Ch);
  const fullScale = drop / Ch; // feet at the panel bottom

  if (establishing) {
    // Full body, feet on the ground, pulled back to reveal the surroundings.
    const scale = Math.min(fullScale, horizontalLimit) * establishingScale;
    return frame(scale, groundY, groundScreenY);
  }

  // Pull in as close as possible. The safe magnification range is
  // [kneeScale, shoulderScale] — a crop anywhere between the knees and the
  // shoulders — plus anything at or below fullScale (full body). The gap
  // (fullScale, kneeScale) would cut the character at the ankles (rule 3), so
  // it is skipped.
  const cap = Math.min(maxScale, horizontalLimit);
  let scale: number;
  if (cap >= shoulderScale) {
    scale = shoulderScale; // no tighter than the shoulders
  } else if (cap >= kneeScale) {
    scale = cap; // a chest / waist shot — safe
  } else if (cap > fullScale) {
    scale = fullScale; // would land in the ankle zone → drop to full body
  } else {
    scale = cap; // full body or, for a wide cast, wider still
  }

  // At or above full body the head is anchored under the balloons and the legs
  // crop off the bottom; below it the character no longer fills the frame, so
  // stand it on the ground instead.
  return scale >= fullScale
    ? frame(scale, headTop, headScreenY)
    : frame(scale, groundY, groundScreenY);
}
