import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  bodyForGesture,
  headForExpression,
  parseCharacterManifest,
  validateCharacterManifest,
  EMOTION_CODES,
} from '../src/manifest.ts';

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
