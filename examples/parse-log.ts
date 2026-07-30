/**
 * Parse a plain-text chat log into composer events.
 *
 * The composer takes structured events, not text — it has no opinion about
 * transport or log format, which is the point. This is a convenience parser for
 * the "one line per message" shape used by the demo. It lives in `examples/`
 * because format-guessing is an application concern.
 *
 * Recognised lines:
 *
 * | Line                          | Becomes                                    |
 * |-------------------------------|--------------------------------------------|
 * | `alice: hello`                | a message                                  |
 * | `alice -> bob: hello`         | a message addressed to `bob`               |
 * | `* alice waves`               | an action (the IRC `/me` convention)       |
 * | `alice (angry): no way`       | a message with an explicit expression      |
 * | `alice (wave): hi`            | an explicit gesture                        |
 * | `alice (whisper): psst`       | a whisper balloon                          |
 * | `alice (think): hmm`          | a thought balloon                          |
 * | `alice -> bob (sad): sorry`   | addressee and a hint together              |
 * | `alice (angry):`              | a wordless reaction — a pose, no balloon   |
 * | *(a blank line)*              | an explicit panel break                    |
 *
 * A parenthetical after the name (and optional `-> addressee`) carries one or
 * more comma-separated hints, each an emotion, a gesture, or a balloon kind
 * (see {@link HINT_WORDS}). A participant's first appearance emits a `join`
 * right before their first line, which triggers an establishing shot.
 * Unrecognised lines are skipped.
 *
 * The last two forms mirror the original client: a hinted line with no text is
 * its *Send Expression* command (the character reacts in the panel they are
 * reacting to, without breaking it), and a blank line is its `<Brk>` — the
 * client turned an empty message into a panel break, so an author could end a
 * panel by pressing Enter twice.
 */

import type { BalloonKind, ChatEvent, Expression, Gesture, MessageEvent } from '../src/types.ts';

export interface ParsedLog {
  events: ChatEvent[];
  /** Participants in first-appearance order. */
  authors: string[];
}

/** Hint word → the expression it sets, including a few natural aliases. */
const EXPRESSION_HINTS: Record<string, Expression> = {
  neutral: 'neutral',
  happy: 'happy',
  glad: 'happy',
  sad: 'sad',
  angry: 'angry',
  mad: 'angry',
  laughing: 'laughing',
  laugh: 'laughing',
  coy: 'coy',
  shy: 'coy',
  shouting: 'shouting',
  yelling: 'shouting',
  scared: 'scared',
  afraid: 'scared',
  bored: 'bored',
};

/** Hint word → the gesture it sets. */
const GESTURE_HINTS: Record<string, Gesture> = {
  wave: 'wave',
  waving: 'wave',
  'point-self': 'point-self',
  'point-me': 'point-self',
  me: 'point-self',
  'point-other': 'point-other',
  'point-you': 'point-other',
  you: 'point-other',
  smile: 'smile',
  shrug: 'shrug',
};

/** Hint word → the balloon kind it forces. */
const KIND_HINTS: Record<string, BalloonKind> = {
  whisper: 'whisper',
  whispers: 'whisper',
  think: 'thought',
  thinks: 'thought',
  thought: 'thought',
  shout: 'shout',
};

/** All recognised hint words, for building help text and pickers. */
export const HINT_WORDS = {
  expressions: Object.keys(EXPRESSION_HINTS),
  gestures: Object.keys(GESTURE_HINTS),
  kinds: Object.keys(KIND_HINTS),
};

const ACTION = /^\*\s*(\S+)\s+(.*)$/;
// name, optional "-> addressee", optional "(hints)", then ": text".
const MESSAGE = /^(\S+?)\s*(?:->\s*(\S+?)\s*)?(?:\(([^)]*)\)\s*)?:\s*(.*)$/;

/** Apply one hint word to the message being built. Unknown words are ignored. */
function applyHint(event: MessageEvent, raw: string): void {
  const word = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (!word) return;
  if (word in KIND_HINTS) event.kind = KIND_HINTS[word];
  else if (word in EXPRESSION_HINTS) event.expressionOverride = EXPRESSION_HINTS[word];
  else if (word in GESTURE_HINTS) event.gestureOverride = GESTURE_HINTS[word];
}

/**
 * @example
 * ```ts
 * parseLog('alice: Hi Bob!\nbob -> alice (laugh): hey');
 * // → join alice, message alice, join bob, message bob (addressed, laughing)
 * ```
 */
export function parseLog(text: string): ParsedLog {
  const events: ChatEvent[] = [];
  const authors: string[] = [];
  const seen = new Set<string>();
  let at = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      // A blank line ends the panel — but only once, and never before the
      // comic has started, so ordinary blank-line spacing between beats does
      // not emit a run of empty breaks.
      if (events.length > 0 && events[events.length - 1]!.type !== 'break') {
        events.push({ type: 'break', at: at++ });
      }
      continue;
    }

    let event: MessageEvent | undefined;

    const action = ACTION.exec(line);
    const message = action ? null : MESSAGE.exec(line);

    if (action) {
      event = { type: 'action', author: action[1]!, text: action[2]!, at: 0 };
    } else if (message) {
      const [, author, addressee, hints, body] = message;
      event = { type: 'message', author: author!, text: body!, at: 0 };
      if (addressee) event.addressees = [addressee];
      if (hints) for (const hint of hints.split(',')) applyHint(event, hint);
    }

    if (!event) continue;

    if (!seen.has(event.author)) {
      seen.add(event.author);
      authors.push(event.author);
      events.push({ type: 'join', author: event.author, at: at++ });
    }

    // A hinted line with no text is a wordless reaction, not an empty balloon.
    if (event.type === 'message' && event.text.trim() === '') {
      const { expressionOverride, gestureOverride, addressees } = event;
      if (expressionOverride === undefined && gestureOverride === undefined) continue;
      events.push({
        type: 'reaction',
        author: event.author,
        ...(expressionOverride !== undefined ? { expression: expressionOverride } : {}),
        ...(gestureOverride !== undefined ? { gesture: gestureOverride } : {}),
        ...(addressees !== undefined ? { addressees } : {}),
        at: at++,
      });
      continue;
    }

    events.push({ ...event, at: at++ });
  }

  // A break with nothing after it would compose to nothing; drop it so
  // trailing blank lines leave no trace in the event stream.
  while (events.length > 0 && events[events.length - 1]!.type === 'break') events.pop();

  return { events, authors };
}
