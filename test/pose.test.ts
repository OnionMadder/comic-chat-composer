import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inferPose } from '../src/pose.ts';

describe('inferPose', () => {
  it('reads emoticons as expressions', () => {
    assert.equal(inferPose('nice work :-)').expression, 'happy');
    assert.equal(inferPose('oh no :-(').expression, 'sad');
  });

  it('reads chat acronyms', () => {
    assert.equal(inferPose('LOL that was great').expression, 'laughing');
    assert.equal(inferPose('IMHO we should wait').gesture, 'point-self');
    assert.equal(inferPose('BRB').gesture, 'wave');
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
