import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateConversation } from '../examples/generate.ts';
import { parseLog } from '../examples/parse-log.ts';
import { compose } from '../src/compose.ts';

describe('generateConversation', () => {
  it('is deterministic — same seed, same comic', () => {
    for (const seed of [0, 1, 42, 1234, 99999]) {
      assert.equal(generateConversation(seed), generateConversation(seed));
    }
  });

  it('every seed yields a valid, fully-resolved chat that composes', () => {
    for (let seed = 0; seed < 250; seed++) {
      const text = generateConversation(seed);
      // No template slots left unfilled.
      assert.ok(!/\{\w/.test(text), `seed ${seed}: unresolved slot in "${text.slice(0, 50)}"`);

      const { events, authors } = parseLog(text);
      assert.ok(authors.length >= 2, `seed ${seed}: < 2 speakers`);
      const messages = events.filter((e) => e.type === 'message' || e.type === 'action');
      assert.ok(messages.length >= 3, `seed ${seed}: < 3 lines`);

      const cast = Object.fromEntries(authors.map((a) => [a, { characterId: 'nib' }]));
      const panels = compose({ events, cast, backdrops: ['room'], seed });
      assert.ok(panels.flatMap((p) => p.balloons).length > 0, `seed ${seed}: no balloons`);
    }
  });

  it('produces high variety across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 250; seed++) seen.add(generateConversation(seed));
    assert.ok(seen.size >= 180, `only ${seen.size}/250 distinct comics`);
  });
});
