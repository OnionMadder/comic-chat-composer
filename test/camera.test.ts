import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeCamera, type CameraCharacter, type CameraOptions } from '../src/camera.ts';

const H = 300;
const W = 400;
const Ch = H * 0.82; // full character height in world units

function options(overrides: Partial<CameraOptions> = {}): CameraOptions {
  return {
    panelWidth: W,
    panelHeight: H,
    characterHeight: Ch,
    groundY: H,
    shoulderFraction: 0.37,
    kneeFraction: 0.8,
    establishing: false,
    maxScale: 2.2,
    headScreenY: 165,
    groundScreenY: H - 9,
    sideMargin: 16,
    establishingScale: 0.85,
    ...overrides,
  };
}

/** World y that the panel bottom cuts the character at, as a fraction of height. */
function bottomCropFraction(cam: ReturnType<typeof computeCamera>): number {
  const headTop = H - Ch;
  const cropWorldY = H / cam.scale + cam.y;
  return (cropWorldY - headTop) / Ch;
}

const char = (x: number, halfWidth = 40): CameraCharacter => ({ x, halfWidth, required: true });

describe('computeCamera — vertical framing rules (§6.2)', () => {
  it('never crops above the shoulders (rule 1: no neck cut)', () => {
    // A solo character invites the tightest possible shot.
    const cam = computeCamera([char(200)], options());
    const crop = bottomCropFraction(cam);
    assert.ok(crop >= 0.37 - 1e-6, `cropped at ${crop.toFixed(2)}, above the shoulders`);
  });

  it('never crops in the ankle zone (rule 3)', () => {
    // Sweep a range of casts and widths; no framing may cut between the knees
    // and the feet.
    for (let halfWidth = 20; halfWidth <= 90; halfWidth += 5) {
      const cam = computeCamera([char(133, halfWidth), char(267, halfWidth)], options());
      const crop = bottomCropFraction(cam);
      const inAnkleZone = crop > 0.8 + 1e-6 && crop < 0.98;
      assert.ok(!inAnkleZone, `halfWidth ${halfWidth}: cropped at ankles (${crop.toFixed(2)})`);
    }
  });

  it('pulls in at least as tight for a solo as for a wide pair', () => {
    const solo = computeCamera([char(200, 60)], options());
    const pair = computeCamera([char(120, 70), char(280, 70)], options());
    assert.ok(solo.scale >= pair.scale, 'a solo shot is never looser than a two-shot');
    assert.ok(solo.scale > pair.scale, 'a wide pair should pull back relative to a solo');
  });

  it('caps magnification at maxScale', () => {
    const cam = computeCamera([char(200)], options({ maxScale: 1.5 }));
    assert.ok(cam.scale <= 1.5 + 1e-6);
  });
});

describe('computeCamera — horizontal framing (rule 2)', () => {
  it('keeps every required character within the panel sides', () => {
    const characters = [char(133, 60), char(267, 60)];
    const cam = computeCamera(characters, options());
    for (const c of characters) {
      assert.ok(c.x - c.halfWidth >= cam.x - 1e-6, `${c.x} cut on the left`);
      assert.ok(c.x + c.halfWidth <= cam.x + cam.width + 1e-6, `${c.x} cut on the right`);
    }
  });

  it('pulls back when the cast is too wide to fit up close', () => {
    const tight = computeCamera([char(133, 30), char(267, 30)], options());
    const wide = computeCamera([char(60, 90), char(340, 90)], options());
    assert.ok(wide.scale < tight.scale, 'a wider cast forces a wider shot');
  });

  it('ignores non-required characters when framing the sides', () => {
    const withOptional = computeCamera(
      [char(200, 40), { x: 390, halfWidth: 40, required: false }],
      options(),
    );
    const soloRequired = computeCamera([char(200, 40)], options());
    assert.equal(withOptional.scale, soloRequired.scale);
  });
});

describe('computeCamera — establishing shots', () => {
  it('pulls back to show the whole figure and its surroundings', () => {
    const establishing = computeCamera([char(200)], options({ establishing: true }));
    const normal = computeCamera([char(200)], options());
    assert.ok(establishing.scale < normal.scale, 'establishing shots pull back');
    // The full character fits with room to spare.
    assert.ok(establishing.height > Ch, 'the whole character should be visible');
  });

  it('still keeps a wide cast within the sides', () => {
    const characters = [char(60, 80), char(200, 80), char(340, 80)];
    const cam = computeCamera(characters, options({ establishing: true }));
    for (const c of characters) {
      assert.ok(c.x - c.halfWidth >= cam.x - 1e-6);
      assert.ok(c.x + c.halfWidth <= cam.x + cam.width + 1e-6);
    }
  });
});

describe('computeCamera — geometry', () => {
  it('reports scale consistent with the window width', () => {
    const cam = computeCamera([char(200)], options());
    assert.ok(Math.abs(cam.scale - W / cam.width) < 1e-6);
  });

  it('locks the aspect ratio (no stretch)', () => {
    const cam = computeCamera([char(133), char(267)], options());
    assert.ok(Math.abs(cam.width / cam.height - W / H) < 1e-6);
  });

  it('handles a panel with no characters', () => {
    const cam = computeCamera([], options({ establishing: true }));
    assert.ok(Number.isFinite(cam.scale) && cam.scale > 0);
    assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y));
  });
});
