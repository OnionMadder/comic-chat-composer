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

declare const __SPRITES__: Record<string, string>;
declare const __MANIFEST__: CharacterManifest;

const sprites = __SPRITES__;
const nib = __MANIFEST__;

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

    const cast = Object.fromEntries(authors.map((a) => [a, { characterId: 'nib' }]));
    const panels = compose({
      events,
      cast,
      backdrops: ['room', 'field', 'pastoral'],
      seed,
      rules: { panelWidth: PANEL_W, panelHeight: PANEL_H },
    });

    out.innerHTML = panels
      .map((p) => {
        const svg = renderPanelToSvg(p, {
          characters: { nib },
          sprite: (src) => sprites[src] ?? '',
          panelWidth: PANEL_W,
          panelHeight: PANEL_H,
          debug,
        });
        const label = `panel ${p.panelIndex} · ${p.zoom} · ${p.backdrop}`;
        return `<figure><div class="frame">${svg}</div><figcaption>${label}</figcaption></figure>`;
      })
      .join('');

    status.textContent = `${events.length} events → ${panels.length} panels · ${authors.length} participants`;
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
