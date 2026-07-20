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

export interface CharacterManifest {
  id: string;
  /** Human-readable name for pickers and credits. */
  name: string;
  /** Optional small icon (the original used 40×40). */
  icon?: string;
  /** One head sprite per emotion code. All seven are required. */
  heads: Record<EmotionCode, HeadSprite>;
  /**
   * Body sprites keyed by gesture. Each value is a list of variants; the
   * composer cycles through a gesture's variants across panels so repeated
   * poses do not look identical. `neutral` is required and is the fallback for
   * any gesture the character does not supply.
   */
  bodies: Partial<Record<Gesture, BodySprite[]>> & { neutral: BodySprite[] };
  /** Backdrop ids this character reads well against, most preferred first. */
  backdropPreferences?: string[];
}

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

/** Resolve the head sprite a given expression should use. */
export function headForExpression(
  manifest: CharacterManifest,
  expression: Expression,
): HeadSprite {
  return manifest.heads[EXPRESSION_TO_CODE[expression]];
}

/**
 * Resolve the body sprite for a gesture, falling back to `neutral` when the
 * character has no art for it.
 *
 * @param variant - Which variant of the gesture to use; wraps around.
 */
export function bodyForGesture(
  manifest: CharacterManifest,
  gesture: Gesture,
  variant = 0,
): BodySprite {
  const list = manifest.bodies[gesture]?.length
    ? manifest.bodies[gesture]!
    : manifest.bodies.neutral;
  return list[((variant % list.length) + list.length) % list.length]!;
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

  if (!isRecord(input.heads)) {
    errors.push('heads: expected an object keyed by emotion code');
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

  if (input.backdropPreferences !== undefined) {
    if (!Array.isArray(input.backdropPreferences)) {
      errors.push('backdropPreferences: expected an array of backdrop ids');
    } else {
      input.backdropPreferences.forEach((b, i) =>
        checkNonEmptyString(b, `backdropPreferences[${i}]`, errors),
      );
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
