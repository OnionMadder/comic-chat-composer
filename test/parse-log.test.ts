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

  it('parses an expression hint', () => {
    const msg = parseLog('alice (angry): no way').events.filter(isMessageEvent)[0]!;
    assert.equal(msg.expressionOverride, 'angry');
    assert.equal(msg.text, 'no way');
  });

  it('parses a gesture hint with an alias and spaces', () => {
    const msg = parseLog('alice (point self): mine').events.filter(isMessageEvent)[0]!;
    assert.equal(msg.gestureOverride, 'point-self');
  });

  it('parses whisper and thought kinds', () => {
    assert.equal(parseLog('a (whisper): psst').events.filter(isMessageEvent)[0]!.kind, 'whisper');
    assert.equal(parseLog('a (think): hmm').events.filter(isMessageEvent)[0]!.kind, 'thought');
  });

  it('combines an addressee with multiple hints', () => {
    const msg = parseLog('alice -> bob (sad, wave): bye').events.filter(isMessageEvent).at(-1)!;
    assert.deepEqual(msg.addressees, ['bob']);
    assert.equal(msg.expressionOverride, 'sad');
    assert.equal(msg.gestureOverride, 'wave');
    assert.equal(msg.text, 'bye');
  });

  it('ignores unknown hint words', () => {
    const msg = parseLog('alice (banana): hi').events.filter(isMessageEvent)[0]!;
    assert.equal(msg.expressionOverride, undefined);
    assert.equal(msg.gestureOverride, undefined);
    assert.equal(msg.text, 'hi');
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

  it('reads a hinted line with no text as a wordless reaction', () => {
    const { events } = parseLog('alice: I ate it\nbob (angry):');
    const reaction = events.find((e) => e.type === 'reaction');
    assert.ok(reaction, 'a hint-only line becomes a reaction, not an empty balloon');
    assert.equal(reaction.author, 'bob');
    assert.equal(reaction.expression, 'angry');
    // Still joins first, so the composer knows they are in the scene.
    assert.ok(events.some((e) => e.type === 'join' && e.author === 'bob'));
  });

  it('carries an addressee and a gesture into a reaction', () => {
    const { events } = parseLog('alice: well?\nbob -> alice (shrug):');
    const reaction = events.find((e) => e.type === 'reaction')!;
    assert.equal(reaction.gesture, 'shrug');
    assert.deepEqual(reaction.addressees, ['alice']);
  });

  it('skips a line with neither text nor hints', () => {
    const { events } = parseLog('alice: hi\nbob:');
    assert.equal(events.filter((e) => e.type === 'reaction').length, 0);
    assert.equal(events.filter((e) => e.type === 'message').length, 1);
  });

  it('turns a blank line into a panel break', () => {
    const { events } = parseLog('alice: one\n\nalice: two');
    const kinds = events.map((e) => e.type);
    assert.deepEqual(kinds, ['join', 'message', 'break', 'message']);
  });

  it('collapses blank-line runs and drops leading and trailing ones', () => {
    // Blank lines used for spacing must not emit a pile of empty breaks, and a
    // break with no panel after it should leave no trace.
    const { events } = parseLog('\n\nalice: one\n\n\n\nalice: two\n\n');
    assert.equal(events.filter((e) => e.type === 'break').length, 1);
    assert.notEqual(events[events.length - 1]!.type, 'break');
  });

  it('breaks the panel where the author asked', () => {
    const script = 'alice: one\nbob: two\n\nalice: three\nbob: four';
    const { events, authors } = parseLog(script);
    const panels = compose({
      events,
      cast: Object.fromEntries(authors.map((a) => [a, { characterId: 'nib' }])),
      backdrops: ['room'],
      seed: 7,
      rules: { establishingShots: 'off' },
    });
    const withText = panels.filter((p) => p.balloons.length > 0);
    // "three" must open a panel rather than joining the one "one"/"two" formed.
    const three = withText.find((p) => p.balloons.some((b) => b.text.includes('THREE')))!;
    assert.ok(!three.balloons.some((b) => b.text.includes('ONE')));
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
