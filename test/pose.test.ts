import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inferPose, isShoutText, SHIPPED_POSE_RULES } from '../src/pose.ts';

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

  it('only fires start rules at a sentence start', () => {
    // "Hi" mid-sentence must not trigger a wave.
    assert.equal(inferPose('she said Hi to me').gesture, 'neutral');
  });

  it('fires start rules at every sentence, not just the first', () => {
    // The shipped client walked each sentence start, so a pronoun opening the
    // second sentence still points.
    assert.equal(inferPose('Well. I think so.').gesture, 'point-self');
    assert.equal(inferPose('Sure thing! You go first.').gesture, 'point-other');
  });

  it('fires phrase forms anywhere in the message', () => {
    // These multi-word cues are unambiguous mid-sentence, and the shipped
    // table matched them as words rather than sentence openers. Anchoring them
    // to the message start meant an ordinary question never pointed.
    assert.equal(inferPose('how are you?').gesture, 'point-other');
    assert.equal(inferPose('so what will you do about it').gesture, 'point-other');
    assert.equal(inferPose("honestly I'm not sure").gesture, 'point-self');
  });

  it('resolves competing cues by strength', () => {
    // The paper flags "Hi Sue, how are you?" as suggesting both a wave and a
    // point; the shipped strengths settle it — "are you" (8) over "Hi" (2).
    assert.equal(inferPose('Hi Sue, how are you?').gesture, 'point-other');
    // Laughter (11) outranks all-caps shouting (9) for the face.
    assert.equal(inferPose('LOL THAT RULES').expression, 'laughing');
    // ...though the balloon is still a shout, which is the point of keeping
    // isShoutText independent of the expression.
    assert.equal(isShoutText('LOL THAT RULES'), true);
  });

  it('fills the expression and the gesture from separate cues', () => {
    // One message, two slots: the strongest expression cue and the strongest
    // gesture cue each win their own slot, as in the original's face/torso fill.
    const pose = inferPose('Are you OK? LOL');
    assert.equal(pose.expression, 'laughing');
    assert.equal(pose.gesture, 'point-other');
  });

  it('accepts a caller-supplied rule table', () => {
    const rules = [
      { match: 'word' as const, text: 'banana', expression: 'happy' as const, strength: 5 },
    ];
    assert.equal(inferPose('banana', { rules }).expression, 'happy');
    // ...and nothing else fires, since the default table is replaced entirely.
    assert.equal(inferPose('LOL', { rules }).expression, 'neutral');
  });

  it('reproduces the shipped table on its own', () => {
    const shipped = { rules: SHIPPED_POSE_RULES };
    assert.equal(inferPose('LOL', shipped).expression, 'laughing');
    assert.equal(inferPose('Howdy folks', shipped).gesture, 'wave');
    // No angry, scared or bored rule existed in any released version, so an
    // angry emoticon came out *sad* — its `:(` tail matched the frown rule and
    // nothing outranked it. Our extra rules are what make it angry.
    assert.equal(inferPose('seriously >:(', shipped).expression, 'sad');
    assert.equal(inferPose('seriously >:(').expression, 'angry');
  });

  it('lets explicit overrides win over inference', () => {
    const pose = inferPose('LOL', { expressionOverride: 'angry', gestureOverride: 'shrug' });
    assert.equal(pose.expression, 'angry');
    assert.equal(pose.gesture, 'shrug');
  });

  it('cycles neutral variants when nothing at all is inferred', () => {
    const a = inferPose('the weather is fine', { previousNeutralVariant: 0, neutralPoseCount: 3 });
    const b = inferPose('so it is', { previousNeutralVariant: a.neutralVariant, neutralPoseCount: 3 });
    assert.notEqual(a.neutralVariant, b.neutralVariant);
  });

  it('holds the neutral variant steady when a gesture does fire', () => {
    const pose = inferPose('Hi there', { previousNeutralVariant: 2, neutralPoseCount: 3 });
    assert.equal(pose.neutralVariant, 2);
  });

  it('holds the neutral variant steady for an expression-only line', () => {
    // An expression gives the character an emotional torso via `bodyForPose`,
    // so the neutral cycle should not advance underneath it.
    const pose = inferPose('oh no :-(', { previousNeutralVariant: 1, neutralPoseCount: 3 });
    assert.equal(pose.neutralVariant, 1);
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
