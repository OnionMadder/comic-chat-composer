/**
 * Browser entry point for the self-contained demo page.
 *
 * `__SPRITES__` and `__MANIFEST__` are substituted at build time by
 * `examples/demo/build.ts`, so the produced HTML has no external requests and
 * works from `file://` or any static host.
 */

import { compose } from '../../src/compose.ts';
import { isExpressive, type CharacterManifest } from '../../src/manifest.ts';
import { seededIndex } from '../../src/rng.ts';
import {
  isMessageEvent,
  type CastEntry,
  type Expression,
  type Gesture,
  type Panel,
} from '../../src/types.ts';
import { CONVERSATIONS } from '../corpus.ts';
import { parseLog } from '../parse-log.ts';
import { renderPanelToSvg, type RenderOptions } from '../render-svg.ts';
import { renderStripSvg } from '../strip.ts';
import { createBuilder, type BuilderApi, type BuilderRow, type LineKind } from './builder.ts';

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

// Neon cast colours — the brand's pink/cyan/violet plus amber/lime/blue buckets.
// A character's colour is a stable function of its slot in the pool, so a given
// character keeps the same colour across conversations and both tabs.
const CAST_COLORS = ['#ff2bb3', '#26ffe6', '#a95eff', '#ffb020', '#7cff4f', '#3d8bff'];
const colorOf = (id: string): string => {
  const i = POOL.indexOf(id);
  return CAST_COLORS[(i < 0 ? 0 : i) % CAST_COLORS.length]!;
};

const $ = (id: string) => document.getElementById(id)!;
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Manual character choices, keyed by participant. Empty means "auto-assign".
// Only used by the Script tab; the Builder tab casts per row directly.
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
        `<div class="chip${manual}" style="--c:${colorOf(current)}"><span class="sw" aria-hidden="true"></span>` +
        `<span class="who">${escapeHtml(a)}</span>` +
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

const seedValue = (): number => Number(($('seed') as HTMLInputElement).value) || 0;

/**
 * Compose and paint the comic from already-resolved inputs. Shared by both the
 * Script tab (which parses a log and auto-casts) and the Builder tab (which
 * hands over events and an explicit cast).
 */
function renderComic(
  events: Parameters<typeof compose>[0]['events'],
  authors: readonly string[],
  cast: Record<string, CastEntry>,
): void {
  const out = $('out');
  const status = $('status');

  if (authors.length === 0) {
    currentPanels = [];
    out.innerHTML = '';
    status.textContent = 'Nothing to compose yet.';
    return;
  }

  const debug = ($('debug') as HTMLInputElement).checked;

  // Scene: a specific backdrop pins the room; "Auto" lets the seed pick one.
  // Either way the whole conversation stays in that one place.
  const scene = ($('scene') as HTMLSelectElement).value;
  const sceneBackdrops = scene ? [scene] : Object.keys(backdrops);

  const panels = compose({
    events,
    cast,
    characterAssets: manifests,
    backdrops: sceneBackdrops,
    seed: seedValue(),
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
}

/** Compose from the Script tab's textarea, auto-casting each participant. */
function runScript(): void {
  const log = ($('log') as HTMLTextAreaElement).value;
  try {
    const { events, authors } = parseLog(log);
    if (authors.length === 0) {
      $('cast').innerHTML = '';
      renderComic(events, authors, {});
      return;
    }
    const castOf = resolveCast(authors, seedValue());
    renderCast(authors, castOf);
    const cast = Object.fromEntries(authors.map((a) => [a, { characterId: castOf.get(a)! }]));
    renderComic(events, authors, cast);
  } catch (error) {
    currentPanels = [];
    $('out').innerHTML = '';
    $('cast').innerHTML = '';
    $('status').textContent = `Error: ${(error as Error).message}`;
  }
}

/** Compose from the Builder tab's rows, which carry their own cast. */
function runBuilder(): void {
  try {
    const { events, authors, cast } = builder.getComposition();
    renderComic(events, authors, cast);
  } catch (error) {
    currentPanels = [];
    $('out').innerHTML = '';
    $('status').textContent = `Error: ${(error as Error).message}`;
  }
}

function run(): void {
  if (activeTab === 'builder') runBuilder();
  else runScript();
}

// ---- The live character preview ("the little Comic Chat head guy") --------

/**
 * Render one character on its own, reacting in the chosen look. Reuses the real
 * renderer via a synthetic single-character panel with an identity camera, so
 * the preview figure is drawn exactly as it would appear in a wide panel — same
 * sprite resolution, same halo — just with no balloon and no backdrop.
 */
function previewSvg(characterId: string, expression: Expression, gesture: Gesture): string {
  const panel: Panel = {
    panelIndex: 0,
    zoom: 'wide',
    camera: { x: 0, y: 0, width: PANEL_W, height: PANEL_H, scale: 1 },
    characters: [{ author: 'preview', characterId, x: PANEL_W / 2, facing: 'right', gesture, expression }],
    balloons: [],
    backdrop: '',
  };
  return renderPanelToSvg(panel, renderOptions(false));
}

// ---- The builder ----------------------------------------------------------

const builder: BuilderApi = createBuilder($('builder-pane'), {
  characterIds: POOL,
  nameOf: (id) => manifests[id]?.name ?? id,
  colorOf,
  previewSvg,
  onChange: () => {
    // A hand edit makes the conversation the user's own (seed stops replacing it).
    authored = true;
    run();
  },
});

/** Turn one corpus conversation into builder rows, casting via the seed. */
function rowsFromConversation(convo: string, seed: number): BuilderRow[] {
  const { events, authors } = parseLog(convo);
  const castOf = resolveCast(authors, seed);
  const rows: BuilderRow[] = [];
  for (const ev of events) {
    if (!isMessageEvent(ev)) continue;
    const characterId = castOf.get(ev.author) ?? POOL[0]!;
    const expression = ev.expressionOverride ?? 'neutral';
    const gesture = ev.gestureOverride ?? 'neutral';
    let kind: LineKind = 'say';
    if (ev.type === 'action') kind = 'action';
    else if (ev.kind === 'whisper') kind = 'whisper';
    else if (ev.kind === 'thought') kind = 'think';
    const addr = ev.addressees?.[0];
    rows.push({
      id: 0, // reassigned by builder.load
      characterId,
      text: ev.text,
      expression,
      intensity: expression === 'neutral' ? 0 : 1,
      gesture,
      addresseeId: addr ? (castOf.get(addr) ?? '') : '',
      kind,
    });
  }
  return rows;
}

// ---- Tabs -----------------------------------------------------------------

type Tab = 'builder' | 'script';
let activeTab: Tab = 'builder';

// The Cast section is `display:flex` in CSS, which beats the `hidden` attribute,
// so its visibility is driven directly. The auto-cast chips only apply to the
// Script tab; the Builder casts per row.
function showCast(show: boolean): void {
  const display = show ? '' : 'none';
  ($('cast-label') as HTMLElement).style.display = display;
  ($('cast') as HTMLElement).style.display = display;
}

function setTab(tab: Tab): void {
  // Leaving the Builder for the Script tab: reveal the script it produced, so a
  // power user can read and tweak the generated `name (hint): text` syntax.
  if (tab === 'script' && activeTab === 'builder') {
    const script = builder.toScript();
    if (script) ($('log') as HTMLTextAreaElement).value = script;
  }
  activeTab = tab;
  $('tab-builder').classList.toggle('is-active', tab === 'builder');
  $('tab-script').classList.toggle('is-active', tab === 'script');
  ($('builder-pane') as HTMLElement).hidden = tab !== 'builder';
  ($('script-pane') as HTMLElement).hidden = tab !== 'script';
  showCast(tab === 'script');
  run();
}

// ---- Downloads ------------------------------------------------------------

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

// ---- Seed → whole comic ---------------------------------------------------

// A seed selects a whole comic: a conversation from the corpus, plus the cast
// and scene that follow from it. Once the user edits it the comic becomes
// "authored" and the seed only re-frames their own lines (scene, layout)
// instead of overwriting them.
let authored = false;
const conversationFor = (seed: number): string =>
  CONVERSATIONS[seededIndex(seed, CONVERSATIONS.length)]!;

/** Load a corpus conversation into both authoring surfaces for the given seed. */
function loadConversation(seed: number): void {
  const convo = conversationFor(seed);
  ($('log') as HTMLTextAreaElement).value = convo;
  builder.load(rowsFromConversation(convo, seed));
}

/** Roll a brand-new random comic: fresh conversation, cast, and scene. */
function surprise(): void {
  authored = false;
  castOverrides.clear();
  const seed = Math.floor(Math.random() * 100000);
  ($('seed') as HTMLInputElement).value = String(seed);
  loadConversation(seed);
  run();
}

// ---- Listeners ------------------------------------------------------------

// Editing the script (power-user tab) makes it the user's own.
$('log').addEventListener('input', () => {
  authored = true;
  run();
});

// Changing the seed re-rolls the conversation too (until it's been authored).
$('seed').addEventListener('input', () => {
  if (!authored) loadConversation(seedValue());
  run();
});

for (const id of ['debug', 'scene']) {
  $(id).addEventListener('change', run);
}

// Reassigning a participant's character from its picker chip (Script tab).
$('cast').addEventListener('change', (event) => {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLSelectElement && target.dataset.author) {
    castOverrides.set(target.dataset.author, target.value);
    run();
  }
});

$('tab-builder').addEventListener('click', () => setTab('builder'));
$('tab-script').addEventListener('click', () => setTab('script'));
$('reseed').addEventListener('click', surprise);
$('example').addEventListener('click', surprise);
$('dl-svg').addEventListener('click', downloadSvg);
$('dl-png').addEventListener('click', downloadPng);

// First paint: seed the builder from the default conversation and compose.
showCast(false);
loadConversation(seedValue());
run();
