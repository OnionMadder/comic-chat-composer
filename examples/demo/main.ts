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
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Manual character choices, keyed by participant. Empty means "auto-assign".
const castOverrides = new Map<string, string>();

/** Resolve each participant to a character: a manual override, else auto-cast. */
function resolveCast(authors: readonly string[], seed: number): Map<string, string> {
  const roster = authors.length <= EXPRESSIVE.length ? EXPRESSIVE : POOL;
  const castOf = new Map<string, string>();
  authors.forEach((a, i) => {
    const override = castOverrides.get(a);
    castOf.set(a, override && manifests[override] ? override : roster[(i + seed) % roster.length]!);
  });
  return castOf;
}

/** Draw a picker chip per participant so the cast can be reassigned by hand. */
function renderCast(authors: readonly string[], castOf: Map<string, string>): void {
  $('cast').innerHTML = authors
    .map((a) => {
      const current = castOf.get(a)!;
      const options = ALL.map(
        (id) =>
          `<option value="${id}"${id === current ? ' selected' : ''}>${escapeHtml(manifests[id]!.name)}</option>`,
      ).join('');
      const manual = castOverrides.has(a) ? ' is-manual' : '';
      return (
        `<div class="chip${manual}"><span class="who">${escapeHtml(a)}</span>` +
        `<span class="arr">plays</span>` +
        `<select data-author="${escapeHtml(a)}" aria-label="Character for ${escapeHtml(a)}">${options}</select></div>`
      );
    })
    .join('');
}

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

    const castOf = resolveCast(authors, seed);
    renderCast(authors, castOf);
    const cast = Object.fromEntries(
      authors.map((a) => [a, { characterId: castOf.get(a)! }]),
    );

    // Scene: a specific backdrop pins the room; "Auto" lets the seed pick one.
    // Either way the whole conversation stays in that one place.
    const scene = ($('scene') as HTMLSelectElement).value;
    const sceneBackdrops = scene ? [scene] : Object.keys(backdrops);

    const panels = compose({
      events,
      cast,
      characterAssets: manifests,
      backdrops: sceneBackdrops,
      seed,
      rules: { panelWidth: PANEL_W, panelHeight: PANEL_H },
    });
    currentPanels = panels;

    const opts = renderOptions(debug);
    out.innerHTML = panels
      .map((p) => {
        const svg = renderPanelToSvg(p, opts);
        const caption = `${p.zoom} · ×${p.camera.scale.toFixed(2)} · ${p.backdrop}`;
        return (
          `<figure class="panel"><div class="frame">${svg}</div>` +
          `<figcaption><span class="pn">${p.panelIndex}</span>${caption}</figcaption></figure>`
        );
      })
      .join('');

    status.textContent = `${panels.length} panels from ${events.length} lines`;
  } catch (error) {
    currentPanels = [];
    out.innerHTML = '';
    $('cast').innerHTML = '';
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

for (const id of ['log', 'seed', 'debug', 'scene']) {
  $(id).addEventListener('input', run);
  $(id).addEventListener('change', run);
}

// Reassigning a participant's character from its picker chip.
$('cast').addEventListener('change', (event) => {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLSelectElement && target.dataset.author) {
    castOverrides.set(target.dataset.author, target.value);
    run();
  }
});

$('reseed').addEventListener('click', () => {
  castOverrides.clear(); // a fresh shuffle drops any manual casting
  ($('seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 100000));
  run();
});

// "Load example" restores the script the page shipped with.
const EXAMPLE_LOG = ($('log') as HTMLTextAreaElement).value;
$('example').addEventListener('click', () => {
  ($('log') as HTMLTextAreaElement).value = EXAMPLE_LOG;
  castOverrides.clear();
  run();
});

$('dl-svg').addEventListener('click', downloadSvg);
$('dl-png').addEventListener('click', downloadPng);

run();
