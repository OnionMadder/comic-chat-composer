/**
 * Gesture and expression inference from message text (§4.1).
 *
 * Comic Chat inspects each message for a small set of textual cues and maps
 * them onto a (gesture, expression) pair. When nothing matches, the character
 * cycles through its neutral poses so that repeated plain messages do not
 * produce visually identical panels.
 */

import type { Expression, Gesture } from './types.ts';

export interface Pose {
  gesture: Gesture;
  expression: Expression;
  /**
   * Index into the character's neutral pose list, advanced each time a message
   * produces no gesture trigger. Renderers may ignore this.
   */
  neutralVariant: number;
}

/**
 * Rules are evaluated in array order and the *last* match wins for each of
 * gesture and expression independently, so later entries act as higher
 * priority. The paper states there is a fixed priority but does not enumerate
 * it; this ordering puts emphatic signals (shouting) above incidental ones
 * (an emoticon buried mid-sentence).
 *
 * TODO(v0.2): confirm the exact priority order against the v1.0 C++ sources
 * once they can be read directly — the extraction plan flags this as one of
 * two details the paper glosses over.
 */
interface Rule {
  test: RegExp;
  gesture?: Gesture;
  expression?: Expression;
  /** Anchored rules only fire at the start of the (trimmed) message. */
  anchored?: boolean;
}

const RULES: Rule[] = [
  // Emoticons.
  { test: /:-?\)/, expression: 'happy' },
  { test: /:-?\(/, expression: 'sad' },
  { test: /:-?D\b/, expression: 'laughing' },
  { test: /;-?\)/, expression: 'coy' },

  // Chat acronyms.
  { test: /\b(?:LOL|ROTFL|LMAO)\b/i, expression: 'laughing' },
  { test: /\bIMHO\b/i, gesture: 'point-self' },
  { test: /\bBRB\b/i, gesture: 'wave' },
  { test: /<g>|<grin>/i, gesture: 'smile', expression: 'happy' },

  // Sentence-initial references.
  { test: /^(?:You|Are you|Will you|Did you|Don't you|Do you)\b/i, gesture: 'point-other', anchored: true },
  { test: /^(?:I|I'll|I will|I'm|I am|I'd|I would)\b/i, gesture: 'point-self', anchored: true },
  { test: /^(?:Hi|Hello|Hey|Bye|Goodbye|Welcome)\b/i, gesture: 'wave', anchored: true },

  // Emphatic typesetting — highest priority, so it survives an earlier match.
  { test: /!{3,}/, expression: 'shouting' },
];

/** True when the text is emphatic all-caps, ignoring non-letters. */
function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && text === text.toUpperCase();
}

export interface InferPoseOptions {
  expressionOverride?: Expression;
  gestureOverride?: Gesture;
  /** Previous neutral variant for this speaker, so neutrals can cycle. */
  previousNeutralVariant?: number;
  /** How many neutral poses the character has. Default 1. */
  neutralPoseCount?: number;
}

/**
 * Infer the pose a message should be drawn with.
 *
 * Explicit overrides (the emotion wheel, in the original UI) always win over
 * inference.
 *
 * @example
 * ```ts
 * inferPose('LOL you are back');
 * // → { gesture: 'point-other', expression: 'laughing', neutralVariant: 0 }
 * ```
 */
export function inferPose(text: string, options: InferPoseOptions = {}): Pose {
  const trimmed = text.trim();
  let gesture: Gesture | undefined;
  let expression: Expression | undefined;

  for (const rule of RULES) {
    const subject = rule.anchored ? trimmed : text;
    if (!rule.test.test(subject)) continue;
    if (rule.gesture) gesture = rule.gesture;
    if (rule.expression) expression = rule.expression;
  }

  if (isAllCaps(trimmed)) expression = 'shouting';

  const neutralCount = Math.max(1, options.neutralPoseCount ?? 1);
  const matchedGesture = gesture !== undefined;

  // No gesture trigger → advance through the neutral poses for visual variety.
  const neutralVariant = matchedGesture
    ? (options.previousNeutralVariant ?? 0)
    : ((options.previousNeutralVariant ?? -1) + 1) % neutralCount;

  return {
    gesture: options.gestureOverride ?? gesture ?? 'neutral',
    expression: options.expressionOverride ?? expression ?? 'neutral',
    neutralVariant,
  };
}
