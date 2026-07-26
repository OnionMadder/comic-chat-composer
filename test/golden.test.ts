import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { composeGolden, GOLDEN_PATH } from './golden/scenario.ts';

/**
 * Golden-master snapshot of the whole composition pipeline.
 *
 * Composition is deterministic (seeded RNG, committed assets), so the composed
 * panels should be byte-for-byte stable. This locks that in: any change to
 * placement, balloon layout, camera framing, backdrop selection, inference or
 * panel-break rules that moves the output will fail here, making the diff
 * explicit and intentional.
 *
 * When a change is deliberate, regenerate the fixture:
 *
 *     UPDATE_GOLDEN=1 npm test
 *
 * then review the diff to `test/golden/panels.json` before committing it.
 */

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

describe('golden master', () => {
  const panels = composeGolden();

  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(GOLDEN_PATH, serialize(panels), 'utf8');
    it('regenerated the golden fixture', () => {
      assert.ok(existsSync(GOLDEN_PATH));
    });
    return;
  }

  it('has a committed fixture (run UPDATE_GOLDEN=1 npm test to create it)', () => {
    assert.ok(existsSync(GOLDEN_PATH), `missing ${GOLDEN_PATH}`);
  });

  it('composes the scenario identically to the committed snapshot', () => {
    const expected = readFileSync(GOLDEN_PATH, 'utf8');
    assert.equal(serialize(panels), expected);
  });

  it('is internally consistent — reading order, no balloon overlap, valid cameras', () => {
    for (const panel of panels) {
      assert.ok(panel.camera.scale > 0 && Number.isFinite(panel.camera.scale));
      const ordered = [...panel.balloons].sort((a, b) => a.readingOrder - b.readingOrder);
      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const a = ordered[i]!;
          const b = ordered[j]!;
          const disjoint =
            a.x + a.width <= b.x + 1e-6 ||
            b.x + b.width <= a.x + 1e-6 ||
            a.y + a.height <= b.y + 1e-6 ||
            b.y + b.height <= a.y + 1e-6;
          assert.ok(disjoint, `panel ${panel.panelIndex}: balloons ${i} and ${j} overlap`);
        }
      }
    }
  });
});
