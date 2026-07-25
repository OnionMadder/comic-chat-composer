import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  layoutBalloons,
  maxAllowable,
  reduceChannel,
  splitOversizedText,
  type BalloonLayoutOptions,
  type BalloonRequest,
} from '../src/balloons.ts';
import { createApproximateMetrics } from '../src/text.ts';
import { createRandom } from '../src/rng.ts';

const metrics = createApproximateMetrics({ fontSize: 12 });

function options(overrides: Partial<BalloonLayoutOptions> = {}): BalloonLayoutOptions {
  return {
    panelWidth: 400,
    region: { top: 6, bottom: 165 },
    metrics,
    minTailChannelWidth: 14,
    rand: createRandom(1234),
    ...overrides,
  };
}

describe('routing channel primitives', () => {
  it('maxAllowable trims Rj from the left when Ri sits to the left', () => {
    const Ri = { l: 0, r: 100 };
    const Rj = { l: 20, r: 200 };
    const out = maxAllowable(Ri, 50, Rj, 150, 14);
    assert.ok(out.l >= Rj.l, 'never widens Rj leftward');
    assert.equal(out.r, Rj.r, 'leaves the right edge alone');
  });

  it('maxAllowable trims Rj from the right when Ri sits to the right', () => {
    const Ri = { l: 100, r: 300 };
    const Rj = { l: 0, r: 250 };
    const out = maxAllowable(Ri, 200, Rj, 50, 14);
    assert.ok(out.r <= Rj.r, 'never widens Rj rightward');
    assert.equal(out.l, Rj.l);
  });

  it('maxAllowable pushes Rj clear of Ri’s speaker and tail room', () => {
    const Ri = { l: 0, r: 100 };
    const xi = 90;
    // Rj is the newer channel, to the right (xj > xi). Its left edge is raised
    // clear of both Ri's speaker xi and Ri's reserved tail room Ri.l + t.
    const out = maxAllowable(Ri, xi, { l: 0, r: 400 }, 200, 14);
    assert.ok(out.l >= xi, 'Rj must clear Ri’s speaker');
    assert.ok(out.l >= Ri.l + 14, 'Ri keeps at least t of tail room on its left');
  });

  it('reduceChannel makes Ri disjoint from Rj', () => {
    const left = reduceChannel({ l: 0, r: 150 }, 50, { l: 100, r: 250 }, 180);
    assert.ok(left.r <= 100, 'left channel ends where the new one begins');

    const right = reduceChannel({ l: 100, r: 300 }, 250, { l: 0, r: 150 }, 60);
    assert.ok(right.l >= 150, 'right channel begins where the new one ends');
  });
});

describe('layoutBalloons', () => {
  const speech = (speaker: string, text: string, speakerX: number): BalloonRequest => ({
    speaker,
    text,
    kind: 'speech',
    speakerX,
  });

  it('places a single balloon over its speaker', () => {
    const req = speech('alice', 'HELLO THERE', 133);
    const { balloons, placedCount } = layoutBalloons([req], options());
    assert.equal(placedCount, 1);
    const b = balloons[0]!;
    assert.ok(b.x <= 133 && b.x + b.width >= 133, 'balloon covers the speaker face centre');
  });

  it('keeps routing channels disjoint across several balloons', () => {
    const reqs = [
      speech('alice', 'FIRST THING SAID', 100),
      speech('bob', 'SECOND THING SAID', 200),
      speech('cara', 'THIRD THING SAID', 300),
    ];
    const { balloons, placedCount } = layoutBalloons(reqs, options());
    assert.equal(placedCount, 3);

    const channels = balloons.map((b) => b.channel).sort((a, b) => a.l - b.l);
    for (let i = 1; i < channels.length; i++) {
      assert.ok(
        channels[i]!.l >= channels[i - 1]!.r - 1e-6,
        `channel ${i} overlaps channel ${i - 1}`,
      );
    }
  });

  it('gives every channel room for a tail', () => {
    const reqs = [
      speech('alice', 'ONE', 80),
      speech('bob', 'TWO', 200),
      speech('cara', 'THREE', 320),
    ];
    const { balloons } = layoutBalloons(reqs, options());
    for (const b of balloons) {
      assert.ok(b.channel.r - b.channel.l > 0, `${b.request.speaker} has an empty channel`);
    }
  });

  it('respects reading order vertically', () => {
    const reqs = [
      speech('alice', 'FIRST UTTERANCE HERE', 100),
      speech('bob', 'SECOND UTTERANCE HERE', 300),
      speech('cara', 'THIRD UTTERANCE HERE', 200),
    ];
    const { balloons } = layoutBalloons(reqs, options());

    // For each pair in utterance order, the later balloon must not read before
    // the earlier one.
    for (let j = 1; j < balloons.length; j++) {
      for (let i = 0; i < j; i++) {
        const a = balloons[i]!;
        const b = balloons[j]!;
        const aCenter = a.x + a.width / 2;
        const bCenter = b.x + b.width / 2;
        if (aCenter > bCenter) {
          assert.ok(b.y >= a.y + a.height - 1e-6, 'balloon to the right must be cleared vertically');
        } else {
          assert.ok(b.y >= a.y - 1e-6, 'balloon to the left must not sit higher');
        }
      }
    }
  });

  it('assigns reading order top-down then left-to-right', () => {
    const reqs = [
      speech('alice', 'ONE TWO THREE', 90),
      speech('bob', 'FOUR FIVE SIX', 310),
      speech('cara', 'SEVEN EIGHT NINE', 200),
    ];
    const { balloons } = layoutBalloons(reqs, options());
    const sorted = [...balloons].sort((a, b) => a.readingOrder - b.readingOrder);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      assert.ok(
        cur.y > prev.y || (cur.y === prev.y && cur.x >= prev.x),
        'reading order must be top-down then left-to-right',
      );
    }
  });

  it('never lets two balloon bodies overlap', () => {
    // Regression: routing channels keep tails disjoint, but a body may extend
    // over a neighbour's channel. Two balloons that overlap horizontally must
    // therefore be separated vertically.
    const cases: BalloonRequest[][] = [
      [speech('alice', 'I MISSED YOU!!!', 133), speech('bob', 'IMHO YOU SHOULD VISIT MORE OFTEN', 267)],
      [speech('alice', 'SHORT', 200), speech('bob', 'A CONSIDERABLY LONGER UTTERANCE', 210)],
      [speech('a', 'ONE TWO', 100), speech('b', 'THREE FOUR FIVE', 120), speech('c', 'SIX SEVEN', 300)],
    ];

    for (const reqs of cases) {
      const { balloons } = layoutBalloons(reqs, options());
      for (let i = 0; i < balloons.length; i++) {
        for (let j = i + 1; j < balloons.length; j++) {
          const a = balloons[i]!;
          const b = balloons[j]!;
          const overlapX = a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6;
          const overlapY = a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;
          assert.ok(
            !(overlapX && overlapY),
            `balloons ${a.request.speaker} and ${b.request.speaker} overlap`,
          );
        }
      }
    }
  });

  it('routes tails toward the speaker with the correct curve direction', () => {
    const reqs = [speech('alice', 'SOMETHING TO SAY', 120)];
    const { balloons } = layoutBalloons(reqs, options());
    const tail = balloons[0]!.tail!;
    assert.equal(tail.toX, 120, 'tail points at the speaker face centre');
    assert.ok(tail.toY >= balloons[0]!.y + balloons[0]!.height, 'tail tip is below the body');
    assert.equal(tail.curve, tail.fromX < 120 ? 'ccw' : 'cw');
  });

  it('gives narration boxes no tail', () => {
    const reqs: BalloonRequest[] = [
      { speaker: 'alice', text: 'waves cheerfully', kind: 'narration', speakerX: 200 },
    ];
    const { balloons } = layoutBalloons(reqs, options());
    assert.equal(balloons[0]!.tail, null);
  });

  it('reports a short placedCount when the panel runs out of room', () => {
    const long = 'THIS IS A FAIRLY LONG UTTERANCE THAT TAKES UP A LOT OF VERTICAL SPACE';
    const reqs = [
      speech('alice', long, 80),
      speech('bob', long, 200),
      speech('cara', long, 320),
      speech('dan', long, 360),
    ];
    // A deliberately shallow balloon region so not everything fits.
    const { placedCount } = layoutBalloons(reqs, options({ region: { top: 6, bottom: 70 } }));
    assert.ok(placedCount < reqs.length, 'layout should refuse to overflow the region');
  });

  it('is deterministic for a given seed', () => {
    const reqs = [speech('alice', 'ONE TWO THREE FOUR', 100), speech('bob', 'FIVE SIX SEVEN', 280)];
    const a = layoutBalloons(reqs, options({ rand: createRandom(7) }));
    const b = layoutBalloons(reqs, options({ rand: createRandom(7) }));
    assert.deepEqual(a, b);
  });
});

describe('splitOversizedText', () => {
  it('leaves text that fits alone', () => {
    assert.deepEqual(splitOversizedText('SHORT ENOUGH', options()), ['SHORT ENOUGH']);
  });

  it('splits text too tall for the region and marks the seams with ellipses', () => {
    const long = Array.from({ length: 160 }, (_, i) => `WORD${i}`).join(' ');
    const chunks = splitOversizedText(long, options({ region: { top: 6, bottom: 60 } }));
    assert.ok(chunks.length > 1, 'oversized text must be split');
    assert.ok(chunks[0]!.endsWith('...'), 'first chunk trails off');
    assert.ok(chunks[chunks.length - 1]!.startsWith('...'), 'last chunk picks up');
  });
});
