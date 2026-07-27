import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CONVERSATIONS } from '../examples/corpus.ts';
import { parseLog } from '../examples/parse-log.ts';
import { compose } from '../src/compose.ts';

describe('demo corpus', () => {
  it('has a healthy number of conversations', () => {
    assert.ok(CONVERSATIONS.length >= 8, `only ${CONVERSATIONS.length} conversations`);
  });

  it('every conversation parses to a multi-line, multi-speaker chat', () => {
    for (const [i, text] of CONVERSATIONS.entries()) {
      const { events, authors } = parseLog(text);
      assert.ok(authors.length >= 2, `conversation ${i} has < 2 speakers`);
      const messages = events.filter((e) => e.type === 'message' || e.type === 'action');
      assert.ok(messages.length >= 3, `conversation ${i} has < 3 lines`);
    }
  });

  it('every conversation composes into panels without throwing', () => {
    for (const [i, text] of CONVERSATIONS.entries()) {
      const { events, authors } = parseLog(text);
      const cast = Object.fromEntries(authors.map((a) => [a, { characterId: 'nib' }]));
      const panels = compose({ events, cast, backdrops: ['room'], seed: 1 });
      assert.ok(panels.length > 0, `conversation ${i} produced no panels`);
      assert.ok(
        panels.flatMap((p) => p.balloons).length > 0,
        `conversation ${i} produced no balloons`,
      );
    }
  });

  it('includes plenty of multi-participant conversations (3+ speakers)', () => {
    const multi = CONVERSATIONS.filter((t) => parseLog(t).authors.length >= 3);
    assert.ok(multi.length >= 10, `only ${multi.length} conversations with 3+ speakers`);
  });

  it('exercises the hint syntax somewhere (whisper/thought + overrides)', () => {
    const kinds = new Set<string>();
    for (const text of CONVERSATIONS) {
      for (const e of parseLog(text).events) {
        if (e.type === 'message' && e.kind) kinds.add(e.kind);
      }
    }
    assert.ok(kinds.has('whisper'), 'no whisper hint used in the corpus');
    assert.ok(kinds.has('thought'), 'no thought hint used in the corpus');
  });
});
