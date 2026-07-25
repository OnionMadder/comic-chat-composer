/**
 * Character asset manifest: schema, types and validation.
 *
 * A Comic Chat character is not a single sprite. Bodies and heads are separate
 * bitmaps that combine freely — any head can sit on any body — which is how a
 * modest set of drawings covers the full gesture × expression matrix. Each
 * sprite carries the anchor points the composer and renderer need:
 *
 *  - a body's `headAttach` and a head's `attach` are registration points that
 *    coincide when the two are composited;
 *  - a head's `tailAnchor` is the point balloon tails aim at (§5.4: tails end
 *    above the centre of the speaker's face);
 *  - optional `halo` bounds carry the outline mask that keeps a character
 *    legible against a busy backdrop (§3, Figure 3).
 *
 * The composer itself never reads pixels — only geometry and identity — so
 * sprite sources may be PNG, SVG, data URIs, or anything the renderer knows
 * how to fetch.
 *
 * Validation is hand-rolled rather than delegated to a schema library so the
 * package keeps zero runtime dependencies.
 */

import type { Expression, Gesture } from './types.ts';

/**
 * Head sprite keys, matching the short codes used by the original character
 * art: happy, laughing, coy, neutral, sad, angry, shouting.
 */
export const EMOTION_CODES = ['hap', 'laf', 'coy', 'neu', 'sad', 'ang', 'sho'] as const;
export type EmotionCode = (typeof EMOTION_CODES)[number];

/** Gesture keys a manifest may supply bodies for. */
export const GESTURE_KEYS: readonly Gesture[] = [
  'neutral',
  'wave',
  'point-self',
  'point-other',
  'smile',
  'shrug',
];

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HeadSprite {
  /** Sprite source — URL, path, or data URI. Opaque to the composer. */
  src: string;
  /** Registration point that coincides with a body's `headAttach`. */
  attach: Point;
  /** Centre of the face; balloon tails point here (§5.4). */
  tailAnchor: Point;
  /** Optional halo mask extent, in sprite coordinates. */
  halo?: Bounds;
}

export interface BodySprite {
  src: string;
  /** Where a head's `attach` point lands on this body. */
  headAttach: Point;
  /** Footprint of the body sprite, used by the zoom rules. */
  bounds: Bounds;
  halo?: Bounds;
}

/**
 * A whole-figure pose: a complete standing figure with the expression and
 * gesture baked in and no separable head. Some original characters (Tux, Waf,
 * Connor, Jordan…) are built this way — one sprite per pose rather than a head
 * combined with a body. A manifest supplies `figures` *instead of*
 * `heads`/`bodies`.
 */
export interface FigureSprite {
  src: string;
  /** The expression or gesture this pose depicts, e.g. `happy` or `wave`. */
  key: Expression | Gesture;
  /** Centre of the face; balloon tails point here (§5.4). */
  tailAnchor: Point;
  /** Footprint of the figure, used by the zoom rules. */
  bounds: Bounds;
  halo?: Bounds;
}

/**
 * Anatomical landmarks used by the camera framing rules (§6.2), as fractions of
 * the character's full standing height measured down from the top of the head.
 *
 * Optional: when a manifest omits these, {@link DEFAULT_FRAMING} is used. They
 * exist so the camera can crop at the shoulders (never the neck) and at the
 * knees (never the ankles) for characters whose proportions differ from the
 * default humanoid.
 */
export interface CharacterFraming {
  /** Head-top to shoulder line. The tightest crop sits here. */
  shoulderFraction: number;
  /** Head-top to knees. A permitted crop line; the ankles are not. */
  kneeFraction: number;
}

export interface CharacterManifest {
  id: string;
  /** Human-readable name for pickers and credits. */
  name: string;
  /** Optional small icon (the original used 40×40). */
  icon?: string;
  /**
   * One head sprite per emotion code, for a layered character. All seven are
   * required. Present together with {@link bodies}, and absent for a
   * whole-figure character (which uses {@link figures} instead).
   */
  heads?: Record<EmotionCode, HeadSprite>;
  /**
   * Body sprites keyed by gesture, for a layered character. Each value is a
   * list of variants the composer cycles through so repeated poses do not look
   * identical; `neutral` is required and is the fallback for any gesture the
   * character does not supply. Absent for a whole-figure character.
   */
  bodies?: Partial<Record<Gesture, BodySprite[]>> & { neutral: BodySprite[] };
  /**
   * Whole-figure poses, for a character with no separable head. Present
   * *instead of* {@link heads} and {@link bodies}. Must include a `neutral`
   * pose as the fallback. See {@link figureFor} for how a pose is chosen.
   */
  figures?: FigureSprite[];
  /** Anatomical crop lines for the camera (§6.2). Optional; see {@link DEFAULT_FRAMING}. */
  framing?: CharacterFraming;
  /** Backdrop ids this character reads well against, most preferred first. */
  backdropPreferences?: string[];
}

/** Whether a manifest is a whole-figure character rather than head + body. */
export function isFigureManifest(manifest: CharacterManifest): boolean {
  return Array.isArray(manifest.figures) && manifest.figures.length > 0;
}

/** The facial expressions a manifest key may name (vs. a gesture). */
const EXPRESSION_KEYS: ReadonlySet<string> = new Set<Expression>([
  'neutral', 'happy', 'sad', 'angry', 'laughing', 'shouting', 'coy', 'scared', 'bored',
]);

/**
 * Whether a character can show more than one facial expression.
 *
 * Layered characters always can (seven emotion heads). Whole-figure characters
 * can only if their poses cover more than one expression — the multi-pose
 * avatars (Connor, Jordan) do; the single-pose ones (Tux, Pedagogue, …) are
 * frozen on one drawing and will never match the text's emotion. Useful for
 * auto-casting: prefer expressive characters so inferred emotions actually show
 * (the paper notes text-only users get assigned a character on the receiver's
 * side, so a sender never guarantees an expressive one).
 */
export function isExpressive(manifest: CharacterManifest): boolean {
  if (!isFigureManifest(manifest)) return true;
  const expressions = new Set(
    manifest.figures!.filter((f) => EXPRESSION_KEYS.has(f.key)).map((f) => f.key),
  );
  return expressions.size >= 2;
}

/** Framing for a roughly humanoid figure, when a manifest gives none. */
export const DEFAULT_FRAMING: CharacterFraming = {
  shoulderFraction: 0.22,
  kneeFraction: 0.78,
};

/** Maps a composer {@link Expression} onto a manifest head sprite key. */
const EXPRESSION_TO_CODE: Record<Expression, EmotionCode> = {
  neutral: 'neu',
  happy: 'hap',
  sad: 'sad',
  angry: 'ang',
  laughing: 'laf',
  shouting: 'sho',
  coy: 'coy',
  // The emotion wheel names these, but the seven-sprite art set has no
  // distinct drawing for either. Fall back to the nearest available.
  scared: 'sho',
  bored: 'neu',
};

/** Resolve the head sprite a given expression should use (layered characters). */
export function headForExpression(
  manifest: CharacterManifest,
  expression: Expression,
): HeadSprite {
  return manifest.heads![EXPRESSION_TO_CODE[expression]];
}

/**
 * Resolve the body sprite for a gesture, falling back to `neutral` when the
 * character has no art for it (layered characters).
 *
 * @param variant - Which variant of the gesture to use; wraps around.
 */
export function bodyForGesture(
  manifest: CharacterManifest,
  gesture: Gesture,
  variant = 0,
): BodySprite {
  const bodies = manifest.bodies!;
  const list = bodies[gesture]?.length ? bodies[gesture]! : bodies.neutral;
  return list[((variant % list.length) + list.length) % list.length]!;
}

/**
 * Resolve the whole-figure pose for an expression and gesture.
 *
 * A distinctive gesture (a wave, a point) reads more strongly at comic scale
 * than a facial expression, so a matching gesture pose is preferred; failing
 * that, a pose matching the expression; failing that, `neutral`. When several
 * poses share a key (some characters have three neutrals), `variant` cycles
 * through them so repeated poses do not look identical.
 */
export function figureFor(
  manifest: CharacterManifest,
  expression: Expression,
  gesture: Gesture,
  variant = 0,
): FigureSprite {
  const figures = manifest.figures!;
  const matching = (key: string): FigureSprite[] => figures.filter((f) => f.key === key);
  const pick =
    (gesture !== 'neutral' && matching(gesture).length ? matching(gesture) : null) ??
    (matching(expression).length ? matching(expression) : null) ??
    (matching('neutral').length ? matching('neutral') : null) ??
    figures;
  return pick[((variant % pick.length) + pick.length) % pick.length]!;
}

/** Proportions the camera needs from a character (§6.2). */
export interface CharacterProportions {
  /** Body width ÷ body height, for the character's horizontal extent. */
  aspect: number;
  /** Head-top to shoulder line, as a fraction of full height. */
  shoulderFraction: number;
  /** Head-top to knees, as a fraction of full height. */
  kneeFraction: number;
}

/**
 * Derive the proportions the camera uses to frame a character, from its neutral
 * pose's bounds and its {@link CharacterFraming} (or the default). Works for
 * both layered and whole-figure characters.
 */
export function characterProportions(manifest: CharacterManifest): CharacterProportions {
  const bounds = isFigureManifest(manifest)
    ? figureFor(manifest, 'neutral', 'neutral').bounds
    : manifest.bodies!.neutral[0]!.bounds;
  const framing = manifest.framing ?? DEFAULT_FRAMING;
  const aspect = bounds.height > 0 ? bounds.width / bounds.height : 0.5;
  return {
    aspect,
    shoulderFraction: framing.shoulderFraction,
    kneeFraction: framing.kneeFraction,
  };
}

// ---- Validation ---------------------------------------------------------

export type ValidationResult =
  | { ok: true; value: CharacterManifest }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkPoint(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected an object with numeric x and y`);
    return;
  }
  for (const k of ['x', 'y']) {
    if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) {
      errors.push(`${path}.${k}: expected a finite number`);
    }
  }
}

function checkBounds(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected an object with x, y, width and height`);
    return;
  }
  for (const k of ['x', 'y', 'width', 'height']) {
    if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) {
      errors.push(`${path}.${k}: expected a finite number`);
    }
  }
}

function checkNonEmptyString(v: unknown, path: string, errors: string[]): void {
  if (typeof v !== 'string' || v.length === 0) {
    errors.push(`${path}: expected a non-empty string`);
  }
}

/**
 * Validate an unknown value against the character manifest schema.
 *
 * Collects every problem rather than failing on the first, so a malformed
 * manifest can be fixed in one pass.
 *
 * @example
 * ```ts
 * const result = validateCharacterManifest(JSON.parse(raw));
 * if (!result.ok) throw new Error(result.errors.join('\n'));
 * ```
 */
export function validateCharacterManifest(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['manifest: expected an object'] };
  }

  checkNonEmptyString(input.id, 'id', errors);
  checkNonEmptyString(input.name, 'name', errors);
  if (input.icon !== undefined) checkNonEmptyString(input.icon, 'icon', errors);

  // A manifest is either a whole-figure character (`figures`) or a layered one
  // (`heads` + `bodies`), never both.
  const isFigure = input.figures !== undefined;

  if (isFigure) {
    if (input.heads !== undefined || input.bodies !== undefined) {
      errors.push('figures: a whole-figure manifest must not also define heads or bodies');
    }
    if (!Array.isArray(input.figures) || input.figures.length === 0) {
      errors.push('figures: expected a non-empty array of poses');
    } else {
      const keys = new Set<string>();
      input.figures.forEach((fig, i) => {
        const path = `figures[${i}]`;
        if (!isRecord(fig)) {
          errors.push(`${path}: expected an object`);
          return;
        }
        checkNonEmptyString(fig.src, `${path}.src`, errors);
        checkNonEmptyString(fig.key, `${path}.key`, errors);
        checkPoint(fig.tailAnchor, `${path}.tailAnchor`, errors);
        checkBounds(fig.bounds, `${path}.bounds`, errors);
        if (fig.halo !== undefined) checkBounds(fig.halo, `${path}.halo`, errors);
        if (typeof fig.key === 'string') keys.add(fig.key);
      });
      if (!keys.has('neutral')) {
        errors.push('figures: at least one pose with key "neutral" is required');
      }
    }
  } else if (!isRecord(input.heads)) {
    errors.push('heads: expected an object keyed by emotion code (or supply figures)');
  } else {
    for (const code of EMOTION_CODES) {
      const head = input.heads[code];
      if (head === undefined) {
        errors.push(`heads.${code}: missing (all seven emotion codes are required)`);
        continue;
      }
      if (!isRecord(head)) {
        errors.push(`heads.${code}: expected an object`);
        continue;
      }
      checkNonEmptyString(head.src, `heads.${code}.src`, errors);
      checkPoint(head.attach, `heads.${code}.attach`, errors);
      checkPoint(head.tailAnchor, `heads.${code}.tailAnchor`, errors);
      if (head.halo !== undefined) checkBounds(head.halo, `heads.${code}.halo`, errors);
    }
  }

  if (!isFigure && input.heads !== undefined) {
    if (!isRecord(input.bodies)) {
      errors.push('bodies: expected an object keyed by gesture');
    } else {
      if (!Array.isArray(input.bodies.neutral) || input.bodies.neutral.length === 0) {
        errors.push('bodies.neutral: at least one neutral body is required');
      }
      for (const [key, value] of Object.entries(input.bodies)) {
        if (!GESTURE_KEYS.includes(key as Gesture)) {
          errors.push(`bodies.${key}: not a recognised gesture`);
          continue;
        }
        if (!Array.isArray(value) || value.length === 0) {
          errors.push(`bodies.${key}: expected a non-empty array of sprites`);
          continue;
        }
        value.forEach((body, i) => {
          const path = `bodies.${key}[${i}]`;
          if (!isRecord(body)) {
            errors.push(`${path}: expected an object`);
            return;
          }
          checkNonEmptyString(body.src, `${path}.src`, errors);
          checkPoint(body.headAttach, `${path}.headAttach`, errors);
          checkBounds(body.bounds, `${path}.bounds`, errors);
          if (body.halo !== undefined) checkBounds(body.halo, `${path}.halo`, errors);
        });
      }
    }
  }

  if (input.backdropPreferences !== undefined) {
    if (!Array.isArray(input.backdropPreferences)) {
      errors.push('backdropPreferences: expected an array of backdrop ids');
    } else {
      input.backdropPreferences.forEach((b, i) =>
        checkNonEmptyString(b, `backdropPreferences[${i}]`, errors),
      );
    }
  }

  if (input.framing !== undefined) {
    if (!isRecord(input.framing)) {
      errors.push('framing: expected an object with shoulderFraction and kneeFraction');
    } else {
      for (const k of ['shoulderFraction', 'kneeFraction'] as const) {
        const v = input.framing[k];
        if (typeof v !== 'number' || !(v > 0 && v < 1)) {
          errors.push(`framing.${k}: expected a number strictly between 0 and 1`);
        }
      }
      const { shoulderFraction, kneeFraction } = input.framing;
      if (
        typeof shoulderFraction === 'number' &&
        typeof kneeFraction === 'number' &&
        shoulderFraction >= kneeFraction
      ) {
        errors.push('framing: shoulderFraction must be above the knees (smaller than kneeFraction)');
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as CharacterManifest };
}

/**
 * Validate and return a manifest, throwing on failure.
 *
 * @throws {Error} listing every validation problem found.
 */
export function parseCharacterManifest(input: unknown): CharacterManifest {
  const result = validateCharacterManifest(input);
  if (!result.ok) {
    throw new Error(`Invalid character manifest:\n  ${result.errors.join('\n  ')}`);
  }
  return result.value;
}
