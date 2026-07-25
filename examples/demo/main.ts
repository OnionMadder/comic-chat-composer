/**
 * Browser entry point for the self-contained demo page.
 *
 * `__SPRITES__` and `__MANIFEST__` are substituted at build time by
 * `examples/demo/build.ts`, so the produced HTML has no external requests and
 * works from `file://` or any static host.
 */

import { compose } from '../../src/compose.ts';
import type { CharacterManifest } from '../../src/manifest.ts';
import { parseLog } from '../parse-log.ts';
import { renderPanelToSvg } from '../render-svg.ts';

// Injected at build time by build.ts: one manifest and one sprite set per
// bundled Comic Chat character, plus the backdrop art.
declare const __MANIFESTS__: Record<string, CharacterManifest>;
declare const __SPRITES__: Record<string, Record<string, string>>;
declare const __BACKDROPS__: Record<string, string>;

const manifests = __MANIFESTS__;
const spritesByChar = __SPRITES__;
const backdrops = __BACKDROPS__;

// The cast pool participants are assigned from, in a stable order.
const POOL = Object.keys(manifests).sort();

const PANEL_W = 400;
const PANEL_H = 300;

const $ = (id: string) => document.getElementById(id)!;

function run(): void {
  const log = ($('log') as HTMLTextAreaElement).value;
  const seed = Number(($('seed') as HTMLInputElement).value) || 0;
  const debug = ($('debug') as HTMLInputElement).checked;
  const out = $('out');
  const status = $('status');

  try {
    const { events, authors } = parseLog(log);
    if (authors.length === 0) {
      out.innerHTML = '';
      status.textContent = 'Nothing to compose yet.';
      return;
    }

    // Give each participant a distinct character, cycling the pool by
    // first-appearance order (seed-shifted so "Randomise" reshuffles casting).
    const castOf = new Map<string, string>();
    authors.forEach((a, i) => castOf.set(a, POOL[(i + seed) % POOL.length]!));
    const cast = Object.fromEntries(
      authors.map((a) => [a, { characterId: castOf.get(a)! }]),
    );

    const panels = compose({
      events,
      cast,
      characterAssets: manifests,
      backdrops: Object.keys(backdrops),
      seed,
      rules: { panelWidth: PANEL_W, panelHeight: PANEL_H },
    });

    out.innerHTML = panels
      .map((p) => {
        const svg = renderPanelToSvg(p, {
          characters: manifests,
          sprite: (src, cid) => spritesByChar[cid]?.[src] ?? '',
          backdrops,
          panelWidth: PANEL_W,
          panelHeight: PANEL_H,
          debug,
        });
        const label = `panel ${p.panelIndex} · ${p.zoom} ×${p.camera.scale.toFixed(2)} · ${p.backdrop}`;
        return `<figure><div class="frame">${svg}</div><figcaption>${label}</figcaption></figure>`;
      })
      .join('');

    const castList = authors.map((a) => `${a}=${manifests[castOf.get(a)!]!.name}`).join(', ');
    status.textContent =
      `${events.length} events → ${panels.length} panels · ${castList}`;
  } catch (error) {
    out.innerHTML = '';
    status.textContent = `Error: ${(error as Error).message}`;
  }
}

for (const id of ['log', 'seed', 'debug']) {
  $(id).addEventListener('input', run);
  $(id).addEventListener('change', run);
}
$('reseed').addEventListener('click', () => {
  ($('seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 100000));
  run();
});

run();
