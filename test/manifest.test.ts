import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  bodyForGesture,
  bodyForPose,
  characterProportions,
  figureFor,
  headForExpression,
  isExpressive,
  isFigureManifest,
  parseCharacterManifest,
  validateCharacterManifest,
  DEFAULT_FRAMING,
  EMOTION_CODES,
} from '../src/manifest.ts';
import type { CharacterManifest } from '../src/manifest.ts';

const nibPath = fileURLToPath(new URL('../assets/characters/nib/character.json', import.meta.url));
const nib = parseCharacterManifest(JSON.parse(readFileSync(nibPath, 'utf8')));

describe('the Nib reference character', () => {
  it('validates against the schema', () => {
    assert.equal(nib.id, 'nib');
    assert.equal(nib.name, 'Nib');
  });

  it('supplies all seven emotion heads', () => {
    const heads = nib.heads!;
    for (const code of EMOTION_CODES) {
      assert.ok(heads[code], `missing head sprite ${code}`);
      assert.match(heads[code].src, /\.svg$/);
    }
  });

  it('supplies at least six gestures including two neutrals', () => {
    const bodies = nib.bodies!;
    assert.ok(Object.keys(bodies).length >= 6);
    assert.equal(bodies.neutral.length, 2, 'neutrals must cycle');
  });

  it('carries camera framing landmarks', () => {
    assert.ok(nib.framing, 'Nib should declare framing');
    assert.ok(nib.framing!.shoulderFraction < nib.framing!.kneeFraction);
  });
});

describe('framing validation', () => {
  it('accepts a valid framing block', () => {
    const result = validateCharacterManifest({
      ...nib,
      framing: { shoulderFraction: 0.3, kneeFraction: 0.75 },
    });
    assert.equal(result.ok, true);
  });

  it('rejects fractions outside (0, 1)', () => {
    const result = validateCharacterManifest({
      ...nib,
      framing: { shoulderFraction: 0, kneeFraction: 1.2 },
    });
    assert.equal(result.ok, false);
  });

  it('rejects shoulders below the knees', () => {
    const result = validateCharacterManifest({
      ...nib,
      framing: { shoulderFraction: 0.85, kneeFraction: 0.4 },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((e) => e.includes('framing')));
  });
});

describe('sprite resolution', () => {
  it('maps expressions onto head sprites', () => {
    assert.equal(headForExpression(nib, 'happy').src, 'head-hap.svg');
    assert.equal(headForExpression(nib, 'laughing').src, 'head-laf.svg');
    assert.equal(headForExpression(nib, 'neutral').src, 'head-neu.svg');
  });

  it('falls back for wheel emotions with no dedicated sprite', () => {
    assert.equal(headForExpression(nib, 'bored').src, 'head-neu.svg');
    assert.equal(headForExpression(nib, 'scared').src, 'head-sho.svg');
  });

  it('cycles neutral body variants and wraps around', () => {
    assert.equal(bodyForGesture(nib, 'neutral', 0).src, 'body-neutral-1.svg');
    assert.equal(bodyForGesture(nib, 'neutral', 1).src, 'body-neutral-2.svg');
    assert.equal(bodyForGesture(nib, 'neutral', 2).src, 'body-neutral-1.svg');
  });

  it('falls back to neutral for a gesture the character lacks', () => {
    const stripped = { ...nib, bodies: { neutral: nib.bodies!.neutral } };
    assert.equal(bodyForGesture(stripped, 'wave').src, 'body-neutral-1.svg');
  });
});

describe('bodyForPose', () => {
  // A manifest in the shape the importer now emits: gesture bodies plus the
  // emotional torsos the original art ships.
  const body = (src: string) => ({ src, headAttach: { x: 5, y: 2 }, bounds: { x: 0, y: 0, width: 10, height: 30 } });
  const m: CharacterManifest = {
    id: 'm',
    name: 'M',
    bodies: {
      neutral: [body('neutral-0.png'), body('neutral-1.png')],
      wave: [body('wave-0.png')],
      angry: [body('angry-0.png')],
      happy: [body('happy-0.png')],
      bored: [body('bored-0.png')],
    },
  };

  it('lets a distinctive gesture win over the expression', () => {
    assert.equal(bodyForPose(m, 'angry', 'wave').src, 'wave-0.png');
  });

  it('uses the emotional torso when the gesture is neutral', () => {
    assert.equal(bodyForPose(m, 'angry', 'neutral').src, 'angry-0.png');
  });

  it('borrows the nearest stance for gestures with no Comic Chat art', () => {
    // No avatar ships smile or shrug torsos; they read as happy/bored.
    assert.equal(bodyForPose(m, 'neutral', 'smile').src, 'happy-0.png');
    assert.equal(bodyForPose(m, 'neutral', 'shrug').src, 'bored-0.png');
  });

  it('reaches a sibling stance for a missing emotional torso', () => {
    // laughing is absent; the one-hop fallback lands on happy.
    assert.equal(bodyForPose(m, 'laughing', 'neutral').src, 'happy-0.png');
  });

  it('cycles neutral variants when the whole pose is neutral', () => {
    assert.equal(bodyForPose(m, 'neutral', 'neutral', 0).src, 'neutral-0.png');
    assert.equal(bodyForPose(m, 'neutral', 'neutral', 1).src, 'neutral-1.png');
    assert.equal(bodyForPose(m, 'neutral', 'neutral', 2).src, 'neutral-0.png');
  });

  it('falls through to neutral when nothing matches', () => {
    assert.equal(bodyForPose(m, 'coy', 'neutral').src, 'neutral-0.png');
  });
});

describe('isExpressive', () => {
  const figure = (keys: string[]): CharacterManifest =>
    ({
      id: 'f',
      name: 'F',
      figures: keys.map((key) => ({
        src: `${key}.png`,
        key,
        tailAnchor: { x: 0, y: 0 },
        bounds: { x: 0, y: 0, width: 10, height: 20 },
      })),
    }) as unknown as CharacterManifest;

  it('treats layered characters as expressive', () => {
    assert.equal(isExpressive(nib), true);
  });

  it('treats a single-pose figure as inexpressive', () => {
    assert.equal(isExpressive(figure(['neutral'])), false);
  });

  it('treats a multi-expression figure as expressive', () => {
    assert.equal(isExpressive(figure(['neutral', 'happy', 'sad'])), true);
  });

  it('does not count gesture-only variety as expression variety', () => {
    // One expression (neutral) plus gestures is still frozen-faced.
    assert.equal(isExpressive(figure(['neutral', 'wave', 'point-self'])), false);
  });
});

// A minimal whole-figure character: two neutrals (to exercise variant
// cycling), one gesture pose and one expression pose.
const figurePose = (src: string, key: string) => ({
  src,
  key,
  tailAnchor: { x: 20, y: 12 },
  bounds: { x: 0, y: 0, width: 40, height: 80 },
});
const figureFixture = {
  id: 'fig',
  name: 'Fig',
  figures: [
    figurePose('neutral-1.png', 'neutral'),
    figurePose('neutral-2.png', 'neutral'),
    figurePose('wave.png', 'wave'),
    figurePose('happy.png', 'happy'),
  ],
};
const figureManifest = parseCharacterManifest(figureFixture);

describe('whole-figure manifests', () => {
  it('validates a well-formed figure manifest', () => {
    const result = validateCharacterManifest(figureFixture);
    assert.equal(result.ok, true);
  });

  it('rejects figures combined with heads', () => {
    // The two character kinds are mutually exclusive; mixing them would leave
    // the renderer guessing which art to draw.
    const result = validateCharacterManifest({ ...figureFixture, heads: nib.heads });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('must not also define')));
    }
  });

  it('requires a neutral pose', () => {
    // Neutral is the universal fallback — without it figureFor has nowhere to land.
    const result = validateCharacterManifest({
      ...figureFixture,
      figures: [figurePose('wave.png', 'wave')],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('neutral')));
    }
  });

  it('reports missing heads AND bodies in one pass', () => {
    // The validator promises every problem at once; bodies errors must appear
    // even when heads is absent entirely.
    const result = validateCharacterManifest({ id: 'x', name: 'X' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.startsWith('heads')), 'heads error missing');
      assert.ok(result.errors.some((e) => e.startsWith('bodies')), 'bodies error missing');
    }
  });

  it('isFigureManifest tells the two kinds apart', () => {
    assert.equal(isFigureManifest(figureManifest), true);
    assert.equal(isFigureManifest(nib), false);
  });

  it('figureFor prefers a matching gesture over the expression', () => {
    // A wave reads more strongly at comic scale than a smile.
    assert.equal(figureFor(figureManifest, 'happy', 'wave').src, 'wave.png');
    assert.equal(figureFor(figureManifest, 'happy', 'neutral').src, 'happy.png');
  });

  it('figureFor falls back to neutral for an unknown pose', () => {
    assert.equal(figureFor(figureManifest, 'scared', 'shrug').src, 'neutral-1.png');
  });

  it('figureFor cycles same-key variants and wraps around', () => {
    assert.equal(figureFor(figureManifest, 'neutral', 'neutral', 0).src, 'neutral-1.png');
    assert.equal(figureFor(figureManifest, 'neutral', 'neutral', 1).src, 'neutral-2.png');
    assert.equal(figureFor(figureManifest, 'neutral', 'neutral', 2).src, 'neutral-1.png');
  });

  it('derives camera proportions from the neutral pose bounds', () => {
    const p = characterProportions(figureManifest);
    assert.equal(p.aspect, 40 / 80);
    // No framing block on the fixture, so the humanoid defaults apply.
    assert.equal(p.shoulderFraction, DEFAULT_FRAMING.shoulderFraction);
    assert.equal(p.kneeFraction, DEFAULT_FRAMING.kneeFraction);
    assert.ok(p.shoulderFraction < p.kneeFraction);
  });
});

describe('validateCharacterManifest', () => {
  it('rejects a non-object', () => {
    const result = validateCharacterManifest('nope');
    assert.equal(result.ok, false);
  });

  it('reports every missing head rather than stopping at the first', () => {
    const result = validateCharacterManifest({
      id: 'x',
      name: 'X',
      heads: {},
      bodies: { neutral: [{ src: 'b.svg', headAttach: { x: 0, y: 0 }, bounds: { x: 0, y: 0, width: 1, height: 1 } }] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors.length, EMOTION_CODES.length);
    }
  });

  it('requires at least one neutral body', () => {
    const result = validateCharacterManifest({ ...nib, bodies: { neutral: [] } });
    assert.equal(result.ok, false);
  });

  it('rejects an unrecognised gesture key', () => {
    const result = validateCharacterManifest({
      ...nib,
      bodies: { ...nib.bodies, moonwalk: nib.bodies!.neutral },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('moonwalk')));
    }
  });

  it('throws with every problem listed', () => {
    assert.throws(() => parseCharacterManifest({ id: '', name: '' }), /Invalid character manifest/);
  });
});
