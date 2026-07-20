import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseLog } from '../examples/parse-log.ts';
import { compose } from '../src/compose.ts';
import { isMessageEvent } from '../src/types.ts';

describe('parseLog', () => {
  it('emits a join before a participant’s first line, once', () => {
    const { events, authors } = parseLog('alice: one\nalice: two');
    assert.deepEqual(authors, ['alice']);
    assert.equal(events.filter((e) => e.type === 'join').length, 1);
    assert.equal(events[0]!.type, 'join');
  });

  it('parses a plain message', () => {
    const { events } = parseLog('alice: hello there');
    const msg = events.filter(isMessageEvent)[0]!;
    assert.equal(msg.type, 'message');
    assert.equal(msg.author, 'alice');
    assert.equal(msg.text, 'hello there');
  });

  it('parses an explicit addressee', () => {
    const { events } = parseLog('alice -> bob: hello');
    const msg = events.filter(isMessageEvent).at(-1)!;
    assert.equal(msg.author, 'alice');
    assert.deepEqual(msg.addressees, ['bob']);
    assert.equal(msg.text, 'hello');
  });

  it('parses an action', () => {
    const { events } = parseLog('* alice waves cheerfully');
    const msg = events.filter(isMessageEvent)[0]!;
    assert.equal(msg.type, 'action');
    assert.equal(msg.author, 'alice');
    assert.equal(msg.text, 'waves cheerfully');
  });

  it('preserves first-appearance order and skips blank lines', () => {
    const { authors } = parseLog('bob: hi\n\n\nalice: hey\nbob: again');
    assert.deepEqual(authors, ['bob', 'alice']);
  });

  it('assigns strictly increasing timestamps', () => {
    const { events } = parseLog('alice: one\nbob: two\nalice: three');
    const times = events.map((e) => e.at);
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i]! > times[i - 1]!, 'timestamps must increase');
    }
  });

  it('skips lines it does not recognise', () => {
    const { events, authors } = parseLog('just some prose with no speaker\n');
    assert.deepEqual(events, []);
    assert.deepEqual(authors, []);
  });

  it('feeds the composer directly', () => {
    const { events, authors } = parseLog(
      'alice: Hi Bob!\nbob -> alice: hey, LOL\n* alice waves',
    );
    const panels = compose({
      events,
      cast: Object.fromEntries(authors.map((a) => [a, { characterId: 'nib' }])),
      backdrops: ['room'],
      seed: 7,
    });
    assert.ok(panels.length > 0);
    assert.ok(panels.flatMap((p) => p.balloons).length > 0);
  });
});
