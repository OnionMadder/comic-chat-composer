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
  // Emoticons. The sad rules come before the angry one so `>:(` — whose tail
  // also matches the plain frown — resolves to angry via last-match-wins.
  { test: /:-?\)/, expression: 'happy' },
  { test: /:-?\(/, expression: 'sad' },
  { test: /:'-?\(/, expression: 'sad' }, // crying — the apostrophe defeats the plain frown rule
  { test: />:-?\(/, expression: 'angry' },
  { test: /:-?D+\b/, expression: 'laughing' }, // D+ so emphatic ":DDD" still matches
  { test: /\bxD\b/i, expression: 'laughing' },
  { test: /;-?\)/, expression: 'coy' },
  { test: /:-?[Pp]\b/, expression: 'coy' },
  { test: /:-?[Oo]\b/, expression: 'scared' },

  // A few high-frequency Unicode emoji.
  { test: /[😀😃😄😁🙂😊]/u, expression: 'happy' },
  { test: /[😂🤣]/u, expression: 'laughing' },
  { test: /[😢😭🙁]/u, expression: 'sad' },
  { test: /[😠😡🤬]/u, expression: 'angry' },
  { test: /[😱😨😰]/u, expression: 'scared' },
  { test: /[😉😏]/u, expression: 'coy' },
  { test: /[🥱😴]/u, expression: 'bored' },

  // Chat acronyms.
  { test: /\b(?:LOL|ROTFL|ROFL|LMAO|LMFAO)\b/i, expression: 'laughing' },
  { test: /\bIMHO\b/i, gesture: 'point-self' },
  { test: /\bBRB\b/i, gesture: 'wave' },
  { test: /<g>|<grin>/i, gesture: 'smile', expression: 'happy' },

  // Sentence-initial references.
  {
    test: /^(?:You|Are you|Will you|Did you|Don't you|Do you|Can you|Could you|Would you|Have you|Why (?:do|don't|did|are|would) you|What (?:do|are|did|would) you)\b/i,
    gesture: 'point-other',
    anchored: true,
  },
  { test: /^(?:I|I'll|I will|I'm|I am|I'd|I would)\b/i, gesture: 'point-self', anchored: true },
  {
    test: /^(?:Hi|Hello|Hey|Heya|Hiya|Howdy|Yo|Sup|GM|Morning|Evening|Good (?:morning|afternoon|evening|night)|Bye|Goodbye|Later|See ya|Welcome)\b/i,
    gesture: 'wave',
    anchored: true,
  },

  // Emphatic typesetting — highest priority, so it survives an earlier match.
  { test: /!{3,}/, expression: 'shouting' },
];

/**
 * Chat acronyms conventionally typed in caps without being yelled. Stripped
 * before the all-caps check so a bare "LOL" or "OMG BRB" does not read as
 * shouting — which would both force the shouting face (overriding the
 * laughing expression the acronym rules just picked) and, via
 * {@link isShoutText}, promote the balloon to a §5.1 starburst.
 */
const CAPS_ACRONYMS =
  /\b(?:LOL|LMAO|LMFAO|ROTFL|ROFL|OMG|WTF|BRB|BBL|IMHO|IMO|BTW|FYI|TTYL|AFK|IDK|TBH|SMH|IIRC|FWIW|IRL|ASAP|AKA|FAQ|GG|GLHF|NP|TY|THX|OK)\b|:-?D+\b|\bXD\b/g;

/**
 * True when the text is emphatic all-caps, ignoring non-letters,
 * conventionally-capitalized chat acronyms, and capital-letter emoticons
 * (":DDD" is a big grin, not a yell).
 */
function isAllCaps(text: string): boolean {
  const letters = text.replace(CAPS_ACRONYMS, '').replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && text === text.toUpperCase();
}

/**
 * True when the text reads as *shouted* — the same emphatic signals that make
 * {@link inferPose} pick the `shouting` expression (all-caps, or three or more
 * exclamation marks). The composer uses this to auto-select a shout balloon for
 * a message that was clearly yelled but given no explicit balloon kind.
 */
export function isShoutText(text: string): boolean {
  const trimmed = text.trim();
  return isAllCaps(trimmed) || /!{3,}/.test(trimmed);
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
 * inferPose('Did you see that? LOL');
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
