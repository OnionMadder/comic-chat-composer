import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inferPose, isShoutText } from '../src/pose.ts';

describe('inferPose', () => {
  it('reads emoticons as expressions', () => {
    assert.equal(inferPose('nice work :-)').expression, 'happy');
    assert.equal(inferPose('oh no :-(').expression, 'sad');
  });

  it('reads the wider emoticon set', () => {
    assert.equal(inferPose("I miss it already :'(").expression, 'sad');
    assert.equal(inferPose('seriously >:(').expression, 'angry');
    assert.equal(inferPose('that was amazing :DDD').expression, 'laughing');
    assert.equal(inferPose('lmao xD').expression, 'laughing');
    assert.equal(inferPose('just kidding :P').expression, 'coy');
    assert.equal(inferPose('wait what :O').expression, 'scared');
  });

  it('reads a few high-frequency emoji', () => {
    assert.equal(inferPose('😂 no way').expression, 'laughing');
    assert.equal(inferPose('great news 😊').expression, 'happy');
    assert.equal(inferPose('oh no 😭').expression, 'sad');
  });

  it('reads chat acronyms', () => {
    assert.equal(inferPose('LOL that was great').expression, 'laughing');
    assert.equal(inferPose('IMHO we should wait').gesture, 'point-self');
    assert.equal(inferPose('BRB').gesture, 'wave');
  });

  it('does not read a bare caps acronym as shouting', () => {
    // "LOL" used to trip the all-caps check, overriding the laughing
    // expression it had just matched — and starbursting the balloon.
    assert.equal(inferPose('LOL').expression, 'laughing');
    assert.equal(inferPose('OMG BRB').expression, 'neutral');
    assert.equal(inferPose(':DDD').expression, 'laughing');
  });

  it('treats all-caps as shouting', () => {
    assert.equal(inferPose('I MISSED YOU').expression, 'shouting');
  });

  it('treats emphatic punctuation as shouting', () => {
    assert.equal(inferPose('get over here!!!').expression, 'shouting');
  });

  it('waves on a sentence-initial greeting', () => {
    assert.equal(inferPose('Hi Bob!').gesture, 'wave');
    assert.equal(inferPose('Goodbye everyone').gesture, 'wave');
  });

  it('points at self or other on sentence-initial pronouns', () => {
    assert.equal(inferPose("I'll handle it").gesture, 'point-self');
    assert.equal(inferPose('You should try it').gesture, 'point-other');
  });

  it('points at the other on modal question openers', () => {
    assert.equal(inferPose('Can you check the door?').gesture, 'point-other');
    assert.equal(inferPose('Could you say that again').gesture, 'point-other');
    assert.equal(inferPose('Have you seen my keys').gesture, 'point-other');
    assert.equal(inferPose("Why don't you go first").gesture, 'point-other');
    assert.equal(inferPose('What do you mean').gesture, 'point-other');
  });

  it('waves on casual greetings', () => {
    assert.equal(inferPose('yo, anyone here?').gesture, 'wave');
    assert.equal(inferPose('sup nerds').gesture, 'wave');
    assert.equal(inferPose('good morning all').gesture, 'wave');
    // "Yo" must not swallow the start of "You".
    assert.equal(inferPose('You did this').gesture, 'point-other');
  });

  it('only fires anchored rules at the start of the message', () => {
    // "Hi" mid-sentence must not trigger a wave.
    assert.equal(inferPose('she said Hi to me').gesture, 'neutral');
  });

  it('lets explicit overrides win over inference', () => {
    const pose = inferPose('LOL', { expressionOverride: 'angry', gestureOverride: 'shrug' });
    assert.equal(pose.expression, 'angry');
    assert.equal(pose.gesture, 'shrug');
  });

  it('cycles neutral variants when nothing triggers a gesture', () => {
    const a = inferPose('the weather is fine', { previousNeutralVariant: 0, neutralPoseCount: 3 });
    const b = inferPose('so it is', { previousNeutralVariant: a.neutralVariant, neutralPoseCount: 3 });
    assert.notEqual(a.neutralVariant, b.neutralVariant);
  });

  it('holds the neutral variant steady when a gesture does fire', () => {
    const pose = inferPose('Hi there', { previousNeutralVariant: 2, neutralPoseCount: 3 });
    assert.equal(pose.neutralVariant, 2);
  });
});

describe('isShoutText', () => {
  it('matches the same emphatic signals as the shouting expression', () => {
    assert.equal(isShoutText('MOO'), true); // all-caps
    assert.equal(isShoutText('get over here!!!'), true); // emphatic punctuation
    assert.equal(isShoutText('  THEO  '), true); // trims first
  });

  it('leaves ordinary and short-caps text alone', () => {
    assert.equal(isShoutText('hey there'), false);
    assert.equal(isShoutText('ok!'), false); // one bang, two letters
    assert.equal(isShoutText('OK'), false); // fewer than 3 letters
    assert.equal(isShoutText('Stop it.'), false);
  });

  it('leaves caps acronyms and caps emoticons alone', () => {
    assert.equal(isShoutText('LOL'), false);
    assert.equal(isShoutText('OMG BRB'), false);
    assert.equal(isShoutText(':DDD'), false);
    assert.equal(isShoutText('XD'), false);
    // ...but real yelling around them still counts.
    assert.equal(isShoutText('LOL STOP IT'), true);
  });
});
