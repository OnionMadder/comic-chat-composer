/**
 * Parse a plain-text chat log into composer events.
 *
 * The composer takes structured events, not text — it has no opinion about
 * transport or log format, which is the point. This is a convenience parser
 * for the common "one line per message" shape, used by the demo page. It lives
 * in `examples/` because format-guessing is an application concern.
 *
 * Recognised lines:
 *
 * | Line                   | Becomes                                  |
 * |------------------------|------------------------------------------|
 * | `alice: hello`         | a message                                |
 * | `alice -> bob: hello`  | a message addressed to `bob`             |
 * | `* alice waves`        | an action (the IRC `/me` convention)     |
 *
 * A participant's first appearance emits a `join` immediately before their
 * first line, which is what triggers an establishing shot. Blank and
 * unrecognised lines are skipped.
 */

import type { ChatEvent, MessageEvent } from '../src/types.ts';

export interface ParsedLog {
  events: ChatEvent[];
  /** Participants in first-appearance order. */
  authors: string[];
}

const ACTION = /^\*\s*(\S+)\s+(.*)$/;
const DIRECTED = /^(\S+?)\s*->\s*(\S+?)\s*:\s*(.*)$/;
const PLAIN = /^(\S+?)\s*:\s*(.*)$/;

/**
 * @example
 * ```ts
 * parseLog('alice: Hi Bob!\nbob -> alice: hey');
 * // → join alice, message alice, join bob, message bob (addressed to alice)
 * ```
 */
export function parseLog(text: string): ParsedLog {
  const events: ChatEvent[] = [];
  const authors: string[] = [];
  const seen = new Set<string>();
  let at = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    let event: MessageEvent | undefined;

    const action = ACTION.exec(line);
    const directed = DIRECTED.exec(line);
    const plain = PLAIN.exec(line);

    if (action) {
      event = { type: 'action', author: action[1]!, text: action[2]!, at: 0 };
    } else if (directed) {
      event = {
        type: 'message',
        author: directed[1]!,
        text: directed[3]!,
        addressees: [directed[2]!],
        at: 0,
      };
    } else if (plain) {
      event = { type: 'message', author: plain[1]!, text: plain[2]!, at: 0 };
    }

    if (!event) continue;

    if (!seen.has(event.author)) {
      seen.add(event.author);
      authors.push(event.author);
      events.push({ type: 'join', author: event.author, at: at++ });
    }
    events.push({ ...event, at: at++ });
  }

  return { events, authors };
}
