/**
 * Gesture and expression inference from message text (§4.1).
 *
 * Comic Chat inspects each message for a small set of textual cues and maps
 * them onto a (gesture, expression) pair. When nothing matches, the character
 * cycles through its neutral poses so that repeated plain messages do not
 * produce visually identical panels.
 *
 * The rules are **data, not code** — which is how the original worked. In the
 * shipped client the whole table lived in localizable string resources
 * (`chat.rc`), parsed at startup into matcher + argument + *strength*, and
 * candidate poses were resolved by strength rather than by evaluation order.
 * {@link SHIPPED_POSE_RULES} reproduces that table; {@link DEFAULT_POSE_RULES}
 * extends it. Callers may pass their own via {@link InferPoseOptions.rules}.
 */

import type { Expression, Gesture } from './types.ts';

export interface Pose {
  gesture: Gesture;
  expression: Expression;
  /**
   * Index into the character's neutral pose list, advanced each time a message
   * leaves the pose entirely neutral. Renderers may ignore this.
   */
  neutralVariant: number;
}

/**
 * How a rule looks for its cue. These are the four matchers the original rule
 * language offered:
 *
 * - `all-caps` — the whole message is emphatic capitals (takes no `text`).
 * - `find` — the literal appears anywhere (a plain substring search).
 * - `word` — the literal appears starting at a word boundary and ending at
 *   whitespace, punctuation, or the end of the message.
 * - `start` — the literal begins a **sentence**. Not just the message: the
 *   original walked every sentence start, so "Well. I think so" points at self.
 */
export type PoseMatcher = 'all-caps' | 'find' | 'word' | 'start';

export interface PoseRule {
  match: PoseMatcher;
  /** The literal to look for. Ignored by (and omitted for) `all-caps`. */
  text?: string;
  /** Match case exactly. The original marked most rules case-insensitive. */
  caseSensitive?: boolean;
  expression?: Expression;
  gesture?: Gesture;
  /**
   * Priority. The highest-strength match fills each of the expression and the
   * gesture slot, independently — so "Are you OK? LOL" gets a laughing face
   * (11) *and* a pointing body (8). Ties break toward the more specific (longer)
   * cue, which is what makes `>:(` beat the `:(` inside it.
   */
  strength: number;
}

/**
 * The rule table Microsoft actually shipped, transcribed from the v1.0 client's
 * string resources (with v2.1b's case-insensitive laughs and `HEHE`, and
 * v2.5's `;)`).
 *
 * Two things stand out. The strengths resolve the priority question the paper
 * leaves open — "a prioritization scheme to choose the most important gesture"
 * — and they put laughter and emoticons *above* shouting, so `LOL THAT RULES`
 * laughs rather than yells. And `angry`, `scared` and `bored` have **no text
 * rules at all**, in every released version: those three could only ever be
 * set by hand on the emotion wheel.
 */
export const SHIPPED_POSE_RULES: readonly PoseRule[] = [
  // Laughter — the strongest cue in the table.
  { match: 'word', text: 'ROTFL', expression: 'laughing', strength: 11 },
  { match: 'word', text: 'LOL', expression: 'laughing', strength: 11 },
  { match: 'find', text: 'HEHE', expression: 'laughing', strength: 11 }, // v2.1b

  // Emoticons.
  { match: 'find', text: ':)', expression: 'happy', strength: 10 },
  { match: 'find', text: ':-)', expression: 'happy', strength: 10 },
  { match: 'find', text: ':(', expression: 'sad', strength: 10 },
  { match: 'find', text: ':-(', expression: 'sad', strength: 10 },
  { match: 'find', text: ';-)', expression: 'coy', strength: 10 },
  { match: 'find', text: ';)', expression: 'coy', strength: 10 }, // v2.5

  // Emphatic typesetting. Deliberately below laughter and emoticons.
  { match: 'all-caps', expression: 'shouting', strength: 9 },
  { match: 'find', text: '!!!', expression: 'shouting', strength: 9 },

  // Second-person phrases — these fire anywhere in the message.
  { match: 'word', text: 'are you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'will you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'did you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: "aren't you", gesture: 'point-other', strength: 8 },
  { match: 'word', text: "don't you", gesture: 'point-other', strength: 8 },

  // First-person phrases.
  { match: 'word', text: "i'm", gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'i will', gesture: 'point-self', strength: 7 },
  { match: 'word', text: "i'll", gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'i am', gesture: 'point-self', strength: 7 },

  // Greetings, at a sentence start.
  { match: 'start', text: 'Hello', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Welcome', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Howdy', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Bye', gesture: 'wave', strength: 3 },
  { match: 'start', text: 'Hi', gesture: 'wave', strength: 2 },

  // Bare pronouns, at a sentence start — the weakest cues, so a phrase form or
  // a greeting in the same message outranks them.
  { match: 'start', text: 'You', gesture: 'point-other', strength: 4 },
  { match: 'start', text: 'I', gesture: 'point-self', strength: 3 },
];

/**
 * Extensions to the shipped table, for cues it never covered: more emoticons,
 * Unicode emoji, a few later acronyms, more question openers and greetings, and
 * — filling the original's most conspicuous gap — text rules for `angry`,
 * `scared` and `bored`, which no message could otherwise trigger.
 *
 * Strengths follow the shipped table's bands: emoticon-strength cues at 10,
 * phrase forms at 8, first-person at 7, greetings at 5 and below.
 */
export const EXTRA_POSE_RULES: readonly PoseRule[] = [
  // Emoticons the original missed. `:'(` and `>:(` contain `:(`, and win the
  // tie on specificity.
  { match: 'find', text: ":'(", expression: 'sad', strength: 10 },
  { match: 'find', text: '>:(', expression: 'angry', strength: 10 },
  { match: 'find', text: ':D', expression: 'laughing', strength: 10 },
  { match: 'find', text: ':-D', expression: 'laughing', strength: 10 },
  { match: 'word', text: 'xD', expression: 'laughing', strength: 10 },
  { match: 'find', text: ':P', expression: 'coy', strength: 10 },
  { match: 'find', text: ':-P', expression: 'coy', strength: 10 },
  { match: 'find', text: ':O', expression: 'scared', strength: 10 },
  { match: 'find', text: ':-O', expression: 'scared', strength: 10 },
  { match: 'find', text: '<g>', gesture: 'smile', expression: 'happy', strength: 10 },
  { match: 'find', text: '<grin>', gesture: 'smile', expression: 'happy', strength: 10 },

  // High-frequency emoji — the modern equivalent of the emoticon rules.
  { match: 'find', text: '😀', expression: 'happy', strength: 10 },
  { match: 'find', text: '😃', expression: 'happy', strength: 10 },
  { match: 'find', text: '😄', expression: 'happy', strength: 10 },
  { match: 'find', text: '🙂', expression: 'happy', strength: 10 },
  { match: 'find', text: '😊', expression: 'happy', strength: 10 },
  { match: 'find', text: '😂', expression: 'laughing', strength: 10 },
  { match: 'find', text: '🤣', expression: 'laughing', strength: 10 },
  { match: 'find', text: '😢', expression: 'sad', strength: 10 },
  { match: 'find', text: '😭', expression: 'sad', strength: 10 },
  { match: 'find', text: '🙁', expression: 'sad', strength: 10 },
  { match: 'find', text: '😠', expression: 'angry', strength: 10 },
  { match: 'find', text: '😡', expression: 'angry', strength: 10 },
  { match: 'find', text: '🤬', expression: 'angry', strength: 10 },
  { match: 'find', text: '😱', expression: 'scared', strength: 10 },
  { match: 'find', text: '😨', expression: 'scared', strength: 10 },
  { match: 'find', text: '😰', expression: 'scared', strength: 10 },
  { match: 'find', text: '😉', expression: 'coy', strength: 10 },
  { match: 'find', text: '😏', expression: 'coy', strength: 10 },
  { match: 'find', text: '🥱', expression: 'bored', strength: 10 },
  { match: 'find', text: '😴', expression: 'bored', strength: 10 },

  // Later acronyms.
  { match: 'word', text: 'ROFL', expression: 'laughing', strength: 11 },
  { match: 'word', text: 'LMAO', expression: 'laughing', strength: 11 },
  { match: 'word', text: 'LMFAO', expression: 'laughing', strength: 11 },
  { match: 'word', text: 'IMHO', gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'IMO', gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'BRB', gesture: 'wave', strength: 5 },

  // Question openers the shipped table left out. All phrase forms, so they
  // fire mid-message like their siblings.
  { match: 'word', text: 'can you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'could you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'would you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'have you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'do you', gesture: 'point-other', strength: 8 },
  { match: 'word', text: "you're", gesture: 'point-other', strength: 8 },
  { match: 'word', text: 'your', gesture: 'point-other', strength: 6 },
  { match: 'word', text: "i'd", gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'i would', gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'i think', gesture: 'point-self', strength: 7 },
  { match: 'word', text: 'my', gesture: 'point-self', strength: 6 },

  // Casual greetings and farewells.
  { match: 'start', text: 'Heya', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Hiya', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Good morning', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Good afternoon', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Good evening', gesture: 'wave', strength: 5 },
  { match: 'start', text: 'Goodbye', gesture: 'wave', strength: 4 },
  { match: 'start', text: 'Hey', gesture: 'wave', strength: 3 },
  { match: 'start', text: 'Yo', gesture: 'wave', strength: 3 },
  { match: 'start', text: 'Sup', gesture: 'wave', strength: 3 },
  { match: 'start', text: 'Later', gesture: 'wave', strength: 3 },
  { match: 'start', text: 'See ya', gesture: 'wave', strength: 3 },
];

/** The shipped table plus {@link EXTRA_POSE_RULES}. The composer's default. */
export const DEFAULT_POSE_RULES: readonly PoseRule[] = [
  ...SHIPPED_POSE_RULES,
  ...EXTRA_POSE_RULES,
];

/**
 * Chat acronyms conventionally typed in caps without being yelled. Stripped
 * before the all-caps check so a bare "LOL" or "OMG BRB" does not read as
 * shouting — which would both pick the shouting face and, via
 * {@link isShoutText}, promote the balloon to a §5.1 starburst.
 *
 * The original had no such guard: `LOL` did match its all-caps rule, but at
 * strength 9 against laughter's 11, so the *face* came out right anyway. The
 * balloon needs the distinction too, hence this list.
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
 * True when the text reads as *shouted* — all-caps, or three or more
 * exclamation marks. The composer uses this to auto-select a shout balloon for
 * a message that was clearly yelled but given no explicit balloon kind.
 *
 * Independent of the inferred expression on purpose: `LOL THAT RULES` earns a
 * laughing face (laughter outranks shouting) inside a shouted balloon, which is
 * exactly how someone yelling with delight should read.
 */
export function isShoutText(text: string): boolean {
  const trimmed = text.trim();
  return isAllCaps(trimmed) || /!{3,}/.test(trimmed);
}

/** Offsets in `text` at which a sentence begins. */
function sentenceStarts(text: string): number[] {
  const starts: number[] = [];
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (atStart && !/\s/.test(ch)) {
      starts.push(i);
      atStart = false;
    } else if (/[.!?]/.test(ch)) {
      atStart = true;
    }
  }
  return starts;
}

/** Whether the character at `i` ends a word (whitespace, punctuation, or end). */
function endsWord(text: string, i: number): boolean {
  return i >= text.length || !/[A-Za-z0-9']/.test(text[i]!);
}

/** Whether the character before `i` is a word boundary. */
function startsWord(text: string, i: number): boolean {
  return i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]!);
}

/** Whether one rule's cue is present in `text`. */
function ruleMatches(rule: PoseRule, text: string): boolean {
  if (rule.match === 'all-caps') return isAllCaps(text.trim());

  const cue = rule.text ?? '';
  if (cue === '') return false;
  const hay = rule.caseSensitive ? text : text.toLowerCase();
  const needle = rule.caseSensitive ? cue : cue.toLowerCase();

  switch (rule.match) {
    case 'find':
      return hay.includes(needle);
    case 'word': {
      let from = 0;
      for (;;) {
        const i = hay.indexOf(needle, from);
        if (i < 0) return false;
        if (startsWord(hay, i) && endsWord(hay, i + needle.length)) return true;
        from = i + 1;
      }
    }
    case 'start':
      return sentenceStarts(hay).some(
        (i) => hay.startsWith(needle, i) && endsWord(hay, i + needle.length),
      );
  }
}

export interface InferPoseOptions {
  expressionOverride?: Expression;
  gestureOverride?: Gesture;
  /** Previous neutral variant for this speaker, so neutrals can cycle. */
  previousNeutralVariant?: number;
  /** How many neutral poses the character has. Default 1. */
  neutralPoseCount?: number;
  /** Rule table to infer from. Defaults to {@link DEFAULT_POSE_RULES}. */
  rules?: readonly PoseRule[];
}

/**
 * Infer the pose a message should be drawn with.
 *
 * Every matching rule becomes a candidate; the strongest one that offers an
 * expression sets the expression, and the strongest that offers a gesture sets
 * the gesture, each resolved independently. That is what the original did —
 * it filled a face slot and a torso slot from one strength-ordered candidate
 * list — and it means a single message can laugh and point at once.
 *
 * Explicit overrides (the emotion wheel, in the original UI) always win.
 *
 * @example
 * ```ts
 * inferPose('Are you OK? LOL');
 * // → { gesture: 'point-other', expression: 'laughing', neutralVariant: 0 }
 * ```
 */
export function inferPose(text: string, options: InferPoseOptions = {}): Pose {
  const rules = options.rules ?? DEFAULT_POSE_RULES;

  const candidates = rules
    .filter((rule) => ruleMatches(rule, text))
    // Strongest first; ties to the longer (more specific) cue.
    .sort((a, b) => b.strength - a.strength || (b.text?.length ?? 0) - (a.text?.length ?? 0));

  let expression: Expression | undefined;
  let gesture: Gesture | undefined;
  for (const rule of candidates) {
    if (expression === undefined && rule.expression !== undefined) expression = rule.expression;
    if (gesture === undefined && rule.gesture !== undefined) gesture = rule.gesture;
    if (expression !== undefined && gesture !== undefined) break;
  }

  const neutralCount = Math.max(1, options.neutralPoseCount ?? 1);
  // Advance the cycle only when nothing at all was inferred. A gesture *or* an
  // expression gives the character a non-neutral body (see `bodyForPose`), and
  // the original only reached for its next neutral when neither slot was
  // filled.
  const posed = gesture !== undefined || expression !== undefined;
  const neutralVariant = posed
    ? (options.previousNeutralVariant ?? 0)
    : ((options.previousNeutralVariant ?? -1) + 1) % neutralCount;

  return {
    gesture: options.gestureOverride ?? gesture ?? 'neutral',
    expression: options.expressionOverride ?? expression ?? 'neutral',
    neutralVariant,
  };
}
