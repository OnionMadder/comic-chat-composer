import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compose } from '../src/compose.ts';
import type { ChatEvent, Panel } from '../src/types.ts';

const cast = {
  alice: { characterId: 'nib' },
  bob: { characterId: 'nib' },
  cara: { characterId: 'nib' },
};

const backdrops = ['room', 'field', 'pastoral'];

function run(events: ChatEvent[], overrides = {}): Panel[] {
  return compose({ events, cast, backdrops, seed: 1234, ...overrides });
}

const SAMPLE: ChatEvent[] = [
  { type: 'join', author: 'alice', at: 0 },
  { type: 'join', author: 'bob', at: 1 },
  { type: 'message', author: 'alice', text: 'Hi Bob!', at: 2 },
  { type: 'message', author: 'bob', text: "Hey Alice, LOL you're back", at: 3, addressees: ['alice'] },
  { type: 'action', author: 'alice', text: 'waves cheerfully', at: 4 },
  { type: 'message', author: 'alice', text: 'I MISSED YOU!!!', at: 5, addressees: ['bob'] },
  { type: 'message', author: 'bob', text: 'IMHO you should visit more often', at: 6, addressees: ['alice'] },
];

describe('compose', () => {
  it('produces panels from a small chat log', () => {
    const panels = run(SAMPLE);
    assert.ok(panels.length > 0);
    panels.forEach((p, i) => assert.equal(p.panelIndex, i, 'panel indices are sequential'));
  });

  it('auto-promotes a yelled message to a shout balloon', () => {
    const balloons = run(SAMPLE).flatMap((p) => p.balloons);
    // "I MISSED YOU!!!" is emphatic — it should shout.
    assert.equal(balloons.find((b) => b.text.includes('MISSED YOU'))?.kind, 'shout');
    // A calm line stays plain speech.
    assert.equal(balloons.find((b) => b.text.includes('SHOULD VISIT'))?.kind, 'speech');
  });

  it('lets an explicit balloon kind override auto-shout', () => {
    const events: ChatEvent[] = [
      { type: 'join', author: 'alice', at: 0 },
      { type: 'message', author: 'alice', text: 'STOP RIGHT THERE', at: 1, kind: 'whisper' },
    ];
    const b = run(events)
      .flatMap((p) => p.balloons)
      .find((x) => x.text.includes('STOP'));
    assert.equal(b?.kind, 'whisper');
  });

  it('folds the opening establishing shot into the first line (default)', () => {
    const panels = run(SAMPLE);
    // The comic still opens on an establishing shot, but it carries dialogue —
    // no blank scene-setting panels.
    assert.equal(panels[0]!.zoom, 'establishing');
    const establishing = panels.filter((p) => p.zoom === 'establishing');
    assert.ok(establishing.length > 0);
    assert.ok(
      establishing.every((p) => p.balloons.length > 0),
      'a folded establishing panel is never blank',
    );
  });

  it('emits standalone empty establishing panels under per-join', () => {
    const panels = run(SAMPLE, { rules: { establishingShots: 'per-join' } });
    assert.equal(panels[0]!.zoom, 'establishing');
    assert.equal(panels[0]!.balloons.length, 0, 'per-join establishing is dialogue-free');
    assert.equal(panels[1]!.zoom, 'establishing');
  });

  it('does not double up establishing shots at periodic boundaries (fold)', () => {
    // A single-speaker monologue: the only opener is one establishing shot, so
    // any *adjacent* establishing panels would be the periodic-fold double-fire.
    const events: ChatEvent[] = [{ type: 'join', author: 'alice', at: 0 }];
    for (let k = 0; k < 20; k++) {
      events.push({ type: 'message', author: 'alice', text: `line number ${k}`, at: 1 + k });
    }
    const zooms = run(events, { rules: { panelsBetweenEstablishingShots: 4 } }).map((p) => p.zoom);
    for (let i = 1; i < zooms.length; i++) {
      assert.ok(
        !(zooms[i] === 'establishing' && zooms[i - 1] === 'establishing'),
        `consecutive establishing panels at ${i - 1}-${i}`,
      );
    }
    // Sanity: at least one periodic shot actually fired beyond the opener.
    assert.ok(zooms.filter((z) => z === 'establishing').length >= 2);
  });

  it('never exceeds the character cap, even when folding a periodic establishing shot', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const events: ChatEvent[] = names.map((n, i) => ({ type: 'join' as const, author: n, at: i }));
    for (let k = 0; k < 40; k++) {
      const author = names[k % names.length]!;
      events.push({ type: 'message', author, text: `line ${k}`, at: 100 + k });
    }
    const bigCast = Object.fromEntries(names.map((n) => [n, { characterId: 'nib' }]));
    const panels = compose({
      events,
      cast: bigCast,
      backdrops,
      seed: 7,
      rules: { panelsBetweenEstablishingShots: 3, maxCharactersPerPanel: 5 },
    });
    for (const p of panels) {
      assert.ok(p.characters.length <= 5, `panel ${p.panelIndex} has ${p.characters.length} characters`);
    }
  });

  it('skips establishing shots entirely under off', () => {
    const panels = run(SAMPLE, { rules: { establishingShots: 'off' } });
    assert.ok(
      panels.every((p) => p.zoom !== 'establishing'),
      'no establishing panels when off',
    );
    assert.ok(panels[0]!.balloons.length > 0, 'opens straight into dialogue');
  });

  it('pulls the cast up to meet short balloons', () => {
    // A one-word panel used to anchor the head at the fixed balloon-region
    // bottom, leaving a dead band under the tiny balloon. The head now anchors
    // just below the actual text, so with the same magnification the camera
    // window sits lower in the world (larger y) — the character rides higher
    // in the frame, closing the gap.
    const compose1 = (text: string) =>
      run([
        { type: 'join', author: 'alice', at: 0 },
        { type: 'message', author: 'alice', text, at: 1 },
      ], { rules: { establishingShots: 'off', soloPanelProbability: 0 } });
    const short = compose1('hi.')[0]!;
    const tall = compose1(
      'this is a much longer message that wraps onto several lines and fills ' +
        'most of the balloon region with text before it finally ends',
    )[0]!;
    assert.ok(short.camera.scale >= tall.camera.scale, 'never frames looser than a tall panel');
    assert.ok(
      short.camera.y > tall.camera.y,
      `short-text panel should raise the cast (camera.y ${short.camera.y} vs ${tall.camera.y})`,
    );
  });

  it('gives every panel a valid camera', () => {
    for (const panel of run(SAMPLE)) {
      const c = panel.camera;
      assert.ok(c.scale > 0 && Number.isFinite(c.scale), `panel ${panel.panelIndex} scale`);
      assert.ok(c.width > 0 && c.height > 0, `panel ${panel.panelIndex} size`);
      assert.ok(Math.abs(c.scale - 400 / c.width) < 1e-6, 'scale agrees with width');
    }
  });

  it('pulls the camera back for establishing shots', () => {
    const panels = run(SAMPLE);
    const establishing = panels.filter((p) => p.zoom === 'establishing');
    const conversational = panels.filter((p) => p.zoom !== 'establishing');
    const widestEstablishing = Math.max(...establishing.map((p) => p.camera.scale));
    const tightestConversational = Math.min(...conversational.map((p) => p.camera.scale));
    assert.ok(
      widestEstablishing < tightestConversational,
      'establishing shots should be wider than any conversational panel',
    );
  });

  it('is deterministic for a fixed seed', () => {
    assert.deepEqual(run(SAMPLE), run(SAMPLE));
  });

  it('produces different layouts for different seeds', () => {
    const a = run(SAMPLE, { seed: 1 });
    const b = run(SAMPLE, { seed: 99999 });
    assert.notDeepEqual(a, b, 'layout randomness should actually vary');
  });

  it('uppercases balloon text but leaves narration alone', () => {
    const panels = run(SAMPLE);
    const balloons = panels.flatMap((p) => p.balloons);

    const speech = balloons.filter((b) => b.kind === 'speech');
    assert.ok(speech.length > 0);
    for (const b of speech) {
      assert.equal(b.text, b.text.toUpperCase(), 'speech balloons are all caps');
    }

    const narration = balloons.find((b) => b.kind === 'narration');
    assert.ok(narration, 'the /me action should become a narration box');
    assert.equal(narration.text, 'waves cheerfully');
    assert.equal(narration.tail, null);
  });

  it('never puts two speech balloons from one character in a panel', () => {
    const panels = run(SAMPLE);
    for (const panel of panels) {
      const speakers = panel.balloons.filter((b) => b.kind !== 'narration').map((b) => b.speaker);
      assert.equal(new Set(speakers).size, speakers.length, `panel ${panel.panelIndex} repeats a speaker`);
    }
  });

  it('keeps every balloon speaker present in their panel', () => {
    for (const panel of run(SAMPLE)) {
      const present = new Set(panel.characters.map((c) => c.author));
      for (const balloon of panel.balloons) {
        assert.ok(present.has(balloon.speaker), `${balloon.speaker} speaks but is not drawn`);
      }
    }
  });

  it('honours the character cap', () => {
    const events: ChatEvent[] = [
      { type: 'message', author: 'alice', text: 'one', at: 0 },
      { type: 'message', author: 'bob', text: 'two', at: 1 },
      { type: 'message', author: 'cara', text: 'three', at: 2 },
    ];
    const panels = compose({ events, cast, backdrops, seed: 5, rules: { maxCharactersPerPanel: 2 } });
    for (const panel of panels) {
      assert.ok(panel.characters.length <= 2, 'cap exceeded');
    }
  });

  it('keeps balloons inside the panel and above the character row', () => {
    const panels = run(SAMPLE);
    const regionBottom = 300 * 0.55;
    for (const panel of panels) {
      for (const b of panel.balloons) {
        assert.ok(b.x >= -1e-6, 'balloon runs off the left edge');
        assert.ok(b.x + b.width <= 400 + 1e-6, 'balloon runs off the right edge');
        assert.ok(b.y + b.height <= regionBottom + 1e-6, 'balloon dips below the balloon region');
      }
    }
  });

  it('never overlaps two balloons within a panel', () => {
    for (const panel of run(SAMPLE)) {
      const bs = panel.balloons;
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i]!;
          const b = bs[j]!;
          const overlapX = a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6;
          const overlapY = a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;
          assert.ok(!(overlapX && overlapY), `panel ${panel.panelIndex}: balloons overlap`);
        }
      }
    }
  });

  it('assigns a contiguous reading order within each panel', () => {
    for (const panel of run(SAMPLE)) {
      const orders = panel.balloons.map((b) => b.readingOrder).sort((a, b) => a - b);
      orders.forEach((o, i) => assert.equal(o, i, 'reading order must be 0..n-1'));
    }
  });

  it('splits an utterance too long for one panel and marks it continued', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const panels = compose({
      events: [{ type: 'message', author: 'alice', text: long, at: 0 }],
      cast,
      backdrops,
      seed: 3,
    });
    const balloons = panels.flatMap((p) => p.balloons);
    assert.ok(balloons.length > 1, 'a very long utterance must span several balloons');
    assert.ok(balloons.every((b) => b.continued), 'split fragments are marked continued');
    assert.ok(balloons[0]!.text.endsWith('...'), 'fragments are joined by ellipses');
  });

  it('accepts a single unsplittable giant token rather than dropping it', () => {
    // One 400-char token can neither wrap nor split into chunks — the
    // accept-overflow branch must still emit the balloon, oversized as it is.
    const giant = 'x'.repeat(400);
    const balloons = run([{ type: 'message', author: 'alice', text: giant, at: 0 }]).flatMap(
      (p) => p.balloons,
    );
    assert.equal(balloons.length, 1, 'the message must not be silently dropped');
    assert.equal(balloons[0]!.text, giant.toUpperCase());
  });

  it('infers addressees from names in the text', () => {
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        { type: 'join', author: 'bob', at: 1 },
        { type: 'message', author: 'alice', text: 'bob what do you think', at: 2 },
      ],
      cast,
      backdrops,
      seed: 11,
    });
    const panel = panels.find((p) => p.balloons.length > 0)!;
    assert.ok(
      panel.characters.some((c) => c.author === 'bob'),
      'an addressee named in the text is pulled into the panel',
    );
  });

  it('lands a reaction in the panel it is reacting to', () => {
    // A wordless reaction from someone already in frame replaces their pose in
    // place — it must NOT break to a new panel, or the beat loses its target.
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        { type: 'join', author: 'bob', at: 1 },
        { type: 'message', author: 'alice', text: 'I ate the last one', at: 2, addressees: ['bob'] },
        { type: 'reaction', author: 'bob', expression: 'angry', at: 3 },
      ],
      cast,
      backdrops,
      seed: 4,
      rules: { establishingShots: 'off' },
    });
    const panel = panels.find((p) => p.balloons.some((b) => b.text.includes('ATE THE LAST')))!;
    assert.ok(panel, 'the line still composes');
    const reactor = panel.characters.find((c) => c.author === 'bob')!;
    assert.equal(reactor.expression, 'angry', 'bob reacts inside the same panel');
  });

  it('lets a reaction override the pose the speaker would have drawn', () => {
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        // "I'll" would infer point-self...
        { type: 'message', author: 'alice', text: "I'll do it", at: 1 },
        // ...but the reaction wins.
        { type: 'reaction', author: 'alice', gesture: 'shrug', expression: 'bored', at: 2 },
      ],
      cast,
      backdrops,
      seed: 4,
      rules: { establishingShots: 'off' },
    });
    const alice = panels.flatMap((p) => p.characters).find((c) => c.author === 'alice')!;
    assert.equal(alice.gesture, 'shrug');
    assert.equal(alice.expression, 'bored');
  });

  it('emits a panel for a reaction with no dialogue at all', () => {
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        { type: 'reaction', author: 'alice', expression: 'scared', at: 1 },
      ],
      cast,
      backdrops,
      seed: 4,
      rules: { establishingShots: 'off' },
    });
    assert.equal(panels.length, 1, 'a silent reaction is still a beat worth drawing');
    assert.equal(panels[0]!.balloons.length, 0);
    assert.equal(panels[0]!.characters[0]!.expression, 'scared');
  });

  it('closes the panel on an explicit break event', () => {
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        { type: 'join', author: 'bob', at: 1 },
        { type: 'message', author: 'alice', text: 'first beat', at: 2 },
        { type: 'break', at: 3 },
        { type: 'message', author: 'bob', text: 'second beat', at: 4 },
      ],
      cast,
      backdrops,
      seed: 4,
      rules: { establishingShots: 'off' },
    });
    const first = panels.find((p) => p.balloons.some((b) => b.text.includes('FIRST')))!;
    assert.ok(
      !first.balloons.some((b) => b.text.includes('SECOND')),
      'the break must keep the two beats in separate panels',
    );
  });

  it('ignores a break that would produce an empty panel', () => {
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        { type: 'break', at: 1 },
        { type: 'break', at: 2 },
        { type: 'message', author: 'alice', text: 'hello', at: 3 },
      ],
      cast,
      backdrops,
      seed: 4,
      rules: { establishingShots: 'off' },
    });
    assert.equal(panels.length, 1);
  });

  it('does not infer an addressee from a bare mid-sentence mention', () => {
    // A participant named with a common word ("will") must not be pulled in —
    // or faced — just because the word appears inside a sentence.
    const panels = compose({
      events: [
        { type: 'join', author: 'alice', at: 0 },
        { type: 'join', author: 'bob', at: 1 },
        { type: 'join', author: 'will', at: 2 },
        { type: 'message', author: 'bob', text: 'who is taking notes today', at: 3 },
        { type: 'message', author: 'alice', text: 'I will do it later', at: 4 },
      ],
      cast: { ...cast, will: { characterId: 'nib' } },
      backdrops,
      seed: 11,
    });
    const panel = panels.find((p) => p.balloons.some((b) => b.text.includes('WILL DO IT')))!;
    assert.ok(panel, 'the line composes into a panel');
    assert.ok(
      !panel.characters.some((c) => c.author === 'will'),
      '"will" the participant stays out of the panel',
    );
  });

  it('keeps one backdrop for the whole conversation', () => {
    const panels = run(SAMPLE);
    assert.ok(panels.length >= 2);
    // The cast stays in one place: every panel — establishing shots included —
    // shows the same setting, so the comic reads as one continuous scene.
    const scene = panels[0]!.backdrop;
    assert.ok(backdrops.includes(scene));
    assert.ok(panels.every((p) => p.backdrop === scene), 'backdrop is constant');
  });

  it('gives different seeds different scenes', () => {
    // Each seed is its own conversation in its own room; across seeds the room
    // varies (not every pair need differ, but the choice must depend on seed).
    const scenes = new Set(
      Array.from({ length: 12 }, (_, s) => run(SAMPLE, { seed: s })[0]!.backdrop),
    );
    assert.ok(scenes.size >= 2, 'the scene should vary with the seed');
  });

  it('honours a character’s backdropPreferences', () => {
    const room = { id: 'r', name: 'R', src: 'r.svg' };
    // A character that reads best against "field", worst against "room".
    const outdoorsy = {
      id: 'out',
      name: 'Out',
      heads: Object.fromEntries(
        ['hap', 'laf', 'coy', 'neu', 'sad', 'ang', 'sho'].map((k) => [
          k,
          { src: `${k}.svg`, attach: { x: 20, y: 36 }, tailAnchor: { x: 20, y: 20 } },
        ]),
      ),
      bodies: { neutral: [{ src: 'b.svg', headAttach: { x: 30, y: 8 }, bounds: { x: 0, y: 0, width: 60, height: 90 } }] },
      backdropPreferences: ['field', 'pastoral', 'room'],
    };
    void room;

    const panels = compose({
      events: [
        { type: 'join', author: 'sam', at: 0 },
        { type: 'message', author: 'sam', text: 'hello there', at: 1 },
      ],
      cast: { sam: { characterId: 'out' } },
      characterAssets: { out: outdoorsy as never },
      backdrops,
      seed: 1,
    });
    // The cast's top-ranked backdrop wins the single scene pick.
    assert.equal(panels[0]!.backdrop, 'field');
  });

  it('falls back to a single backdrop without cycling', () => {
    const panels = compose({
      events: SAMPLE,
      cast,
      backdrops: ['room'],
      seed: 2,
    });
    assert.ok(panels.every((p) => p.backdrop === 'room'));
  });

  it('handles an empty event list', () => {
    assert.deepEqual(run([]), []);
  });

  it('ignores leave events without emitting a panel', () => {
    const panels = run([
      { type: 'join', author: 'alice', at: 0 },
      { type: 'message', author: 'alice', text: 'hello', at: 1 },
      { type: 'leave', author: 'alice', at: 2 },
    ]);
    // The line composes one (establishing, folded) panel; the leave adds nothing.
    assert.equal(panels.length, 1, 'only the message produces a panel');
  });
});

describe('facing overrides', () => {
  /** The last panel holds every line, since nothing here forces a break. */
  const facingIn = (events: ChatEvent[], author: string): string | undefined => {
    const panels = run(events, { rules: { establishingShots: 'off' } });
    for (const panel of panels) {
      const found = panel.characters.find((c) => c.author === author);
      if (found) return found.facing;
    }
    return undefined;
  };

  it('turns a speaker the way the event asks, not the way the solver would', () => {
    const base: ChatEvent[] = [
      { type: 'message', author: 'alice', text: 'Bob, over here.', addressees: ['bob'], at: 0 },
      { type: 'message', author: 'bob', text: 'Coming.', at: 1 },
    ];
    const free = facingIn(base, 'alice');
    const away = free === 'left' ? 'right' : 'left';
    const forced = base.map((e, i) => (i === 0 ? { ...e, facing: away } : e)) as ChatEvent[];
    assert.equal(facingIn(forced, 'alice'), away);
  });

  it('honours a facing on a wordless reaction', () => {
    const events: ChatEvent[] = [
      { type: 'message', author: 'alice', text: 'Well?', addressees: ['bob'], at: 0 },
      { type: 'reaction', author: 'bob', gesture: 'shrug', facing: 'right', at: 1 },
    ];
    assert.equal(facingIn(events, 'bob'), 'right');
  });

  it('leaves unlocked characters to the solver', () => {
    const events: ChatEvent[] = [
      {
        type: 'message',
        author: 'alice',
        text: 'I am talking to someone outside.',
        facing: 'left',
        at: 0,
      },
      { type: 'message', author: 'bob', text: 'Alice, who is that?', addressees: ['alice'], at: 1 },
    ];
    assert.equal(facingIn(events, 'alice'), 'left');
    // Bob addressed Alice and is free, so he must be turned towards her.
    const panels = run(events, { rules: { establishingShots: 'off' } });
    const panel = panels.find((p) => p.characters.length === 2)!;
    const alice = panel.characters.find((c) => c.author === 'alice')!;
    const bob = panel.characters.find((c) => c.author === 'bob')!;
    assert.equal(bob.facing, bob.x < alice.x ? 'right' : 'left');
  });
});
