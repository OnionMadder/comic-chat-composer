import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseCharacterManifest, bodyForGesture, isFigureManifest } from '../src/manifest.ts';
import { compose } from '../src/compose.ts';
import { EMOTION_CODES } from '../src/manifest.ts';

const ROOT = 'assets/comic-chat/characters';

describe('bundled Comic Chat characters', () => {
  const ids = existsSync(ROOT) ? readdirSync(ROOT) : [];

  it('bundles the expected cast', () => {
    assert.ok(ids.length >= 15, `expected 15+ characters, found ${ids.length}`);
    for (const expected of ['anna', 'hugh', 'tiki']) {
      assert.ok(ids.includes(expected), `missing ${expected}`);
    }
  });

  for (const id of ids) {
    describe(id, () => {
      const manifest = parseCharacterManifest(
        JSON.parse(readFileSync(join(ROOT, id, 'character.json'), 'utf8')),
      );

      it('validates and covers its poses', () => {
        if (isFigureManifest(manifest)) {
          assert.ok(
            manifest.figures!.some((f) => f.key === 'neutral'),
            `${id} has no neutral figure`,
          );
        } else {
          for (const code of EMOTION_CODES) {
            assert.ok(manifest.heads![code], `${id} missing head ${code}`);
          }
        }
      });

      it('has a neutral pose and real framing landmarks', () => {
        if (isFigureManifest(manifest)) {
          assert.ok(manifest.figures!.length, `${id} has no figures`);
        } else {
          assert.ok(manifest.bodies!.neutral?.length, `${id} has no neutral body`);
        }
        assert.ok(manifest.framing, `${id} has no framing`);
        assert.ok(manifest.framing!.shoulderFraction < manifest.framing!.kneeFraction);
      });

      it('every sprite src resolves to a file on disk', () => {
        const srcs = new Set<string>();
        if (isFigureManifest(manifest)) {
          for (const f of manifest.figures!) srcs.add(f.src);
        } else {
          for (const code of EMOTION_CODES) srcs.add(manifest.heads![code].src);
          for (const list of Object.values(manifest.bodies!)) {
            for (const b of list ?? []) srcs.add(b.src);
          }
        }
        for (const src of srcs) {
          assert.ok(existsSync(join(ROOT, id, src)), `${id}: missing sprite ${src}`);
        }
      });
    });
  }

  it('composes a panel from a real character', () => {
    const hugh = parseCharacterManifest(
      JSON.parse(readFileSync(join(ROOT, 'hugh', 'character.json'), 'utf8')),
    );
    const panels = compose({
      events: [
        { type: 'join', author: 'h', at: 0 },
        { type: 'message', author: 'h', text: 'I MISSED YOU!!!', at: 1 },
      ],
      cast: { h: { characterId: 'hugh' } },
      characterAssets: { hugh },
      backdrops: ['room'],
      seed: 3,
    });
    const speaking = panels.find((p) => p.balloons.length > 0)!;
    const c = speaking.characters[0]!;
    // "!!!" infers a shout, which must resolve to a real head sprite.
    assert.equal(c.expression, 'shouting');
    assert.ok(bodyForGesture(hugh, c.gesture).src.endsWith('.png'));
  });
});
