/**
 * Browser entry point for the self-contained demo page.
 *
 * `__SPRITES__` and `__MANIFEST__` are substituted at build time by
 * `examples/demo/build.ts`, so the produced HTML has no external requests and
 * works from `file://` or any static host.
 */

import { compose } from '../../src/compose.ts';
import { isExpressive, type CharacterManifest } from '../../src/manifest.ts';
import type { Panel } from '../../src/types.ts';
import { parseLog } from '../parse-log.ts';
import { renderPanelToSvg, type RenderOptions } from '../render-svg.ts';
import { renderStripSvg } from '../strip.ts';

// Injected at build time by build.ts: one manifest and one sprite set per
// bundled Comic Chat character, plus the backdrop art.
declare const __MANIFESTS__: Record<string, CharacterManifest>;
declare const __SPRITES__: Record<string, Record<string, string>>;
declare const __BACKDROPS__: Record<string, string>;

const manifests = __MANIFESTS__;
const spritesByChar = __SPRITES__;
const backdrops = __BACKDROPS__;

// The cast pool participants are assigned from. Expressive characters (seven
// emotion heads, or multi-pose figures) come first so inferred emotions
// actually show; the single-pose whole-figure avatars (Tux, Pedagogue, …) are
// frozen on one drawing, so they're held back and only used once a cast is
// larger than the expressive roster.
const ALL = Object.keys(manifests).sort();
const EXPRESSIVE = ALL.filter((id) => isExpressive(manifests[id]!));
const FLAT = ALL.filter((id) => !isExpressive(manifests[id]!));
const POOL = [...EXPRESSIVE, ...FLAT];

const PANEL_W = 400;
const PANEL_H = 300;

const $ = (id: string) => document.getElementById(id)!;

/** Render options are the same for on-screen panels and the downloadable strip. */
function renderOptions(debug: boolean): RenderOptions {
  return {
    characters: manifests,
    sprite: (src, cid) => spritesByChar[cid]?.[src] ?? '',
    backdrops,
    panelWidth: PANEL_W,
    panelHeight: PANEL_H,
    debug,
  };
}

/** The panels from the most recent compose, for the download buttons to act on. */
let currentPanels: Panel[] = [];

function run(): void {
  const log = ($('log') as HTMLTextAreaElement).value;
  const seed = Number(($('seed') as HTMLInputElement).value) || 0;
  const debug = ($('debug') as HTMLInputElement).checked;
  const out = $('out');
  const status = $('status');

  try {
    const { events, authors } = parseLog(log);
    if (authors.length === 0) {
      currentPanels = [];
      out.innerHTML = '';
      status.textContent = 'Nothing to compose yet.';
      return;
    }

    // Give each participant a distinct character, cycling the pool by
    // first-appearance order (seed-shifted so "Randomise" reshuffles casting).
    // Draw only from the expressive roster while the cast fits in it, so a
    // small chat never lands two frozen single-pose avatars; fall back to the
    // full pool only for a cast larger than the expressive roster.
    const roster = authors.length <= EXPRESSIVE.length ? EXPRESSIVE : POOL;
    const castOf = new Map<string, string>();
    authors.forEach((a, i) => castOf.set(a, roster[(i + seed) % roster.length]!));
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
    currentPanels = panels;

    const opts = renderOptions(debug);
    out.innerHTML = panels
      .map((p) => {
        const svg = renderPanelToSvg(p, opts);
        const label = `panel ${p.panelIndex} · ${p.zoom} ×${p.camera.scale.toFixed(2)} · ${p.backdrop}`;
        return `<figure><div class="frame">${svg}</div><figcaption>${label}</figcaption></figure>`;
      })
      .join('');

    const castList = authors.map((a) => `${a}=${manifests[castOf.get(a)!]!.name}`).join(', ');
    status.textContent =
      `${events.length} events → ${panels.length} panels · ${castList}`;
  } catch (error) {
    currentPanels = [];
    out.innerHTML = '';
    status.textContent = `Error: ${(error as Error).message}`;
  }
}

/** Trigger a browser download of a blob under a filename. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build the current strip as one SVG string, or null if there's nothing to save. */
function currentStripSvg(): string | null {
  if (currentPanels.length === 0) return null;
  const columns = Number(($('cols') as HTMLInputElement).value) || 3;
  // Never draw the layout guides into a saved image.
  return renderStripSvg(currentPanels, renderOptions(false), { columns });
}

function downloadSvg(): void {
  const svg = currentStripSvg();
  if (!svg) return;
  download(new Blob([svg], { type: 'image/svg+xml' }), 'comic.svg');
}

function downloadPng(): void {
  const svg = currentStripSvg();
  if (!svg) return;
  const scale = 2; // render at 2× for a crisp raster
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => {
      if (blob) download(blob, 'comic.png');
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    $('status').textContent = 'Could not rasterise the strip to PNG.';
  };
  img.src = svgUrl;
}

for (const id of ['log', 'seed', 'debug']) {
  $(id).addEventListener('input', run);
  $(id).addEventListener('change', run);
}
$('reseed').addEventListener('click', () => {
  ($('seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 100000));
  run();
});
$('dl-svg').addEventListener('click', downloadSvg);
$('dl-png').addEventListener('click', downloadPng);

run();
