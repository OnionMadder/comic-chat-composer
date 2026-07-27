/**
 * Browser entry point for the self-contained demo page.
 *
 * `__SPRITES__` and `__MANIFEST__` are substituted at build time by
 * `examples/demo/build.ts`, so the produced HTML has no external requests and
 * works from `file://` or any static host.
 */

import { compose } from '../../src/compose.ts';
import { isExpressive, type CharacterManifest } from '../../src/manifest.ts';
import {
  isMessageEvent,
  type CastEntry,
  type Expression,
  type Gesture,
  type Panel,
} from '../../src/types.ts';
import { generateConversation } from '../generate.ts';
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

// Shown as a small credit under a titled strip export (never on an untitled one).
const EXPORT_CREDIT = 'onionmadder.com/comic-chat-composer';
const titleValue = (): string => ($('title') as HTMLInputElement).value.trim();
const subtitleValue = (): string => ($('subtitle') as HTMLInputElement).value.trim();

/** Echo the title/subtitle above the on-screen comic, so it's visible before export. */
function renderComicTitle(): void {
  const t = titleValue();
  const s = subtitleValue();
  const el = $('comic-title') as HTMLElement;
  if (!t && !s) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML =
    (t ? `<div class="ct-title">${escapeHtml(t)}</div>` : '') +
    (s ? `<div class="ct-sub">${escapeHtml(s)}</div>` : '');
}

// Manual character choices, keyed by participant. Empty means "auto-assign".
// Only used by the Script tab; the Builder tab casts per row directly.
const castOverrides = new Map<string, string>();

/**
 * Resolve each participant to a character. Precedence: a manual override, then a
 * participant whose name *is* a character id (so `tux: hi` casts Tux — this is
 * what lets a Builder-authored script round-trip its exact cast through a share
 * link), then a seed-based auto-assignment.
 */
function resolveCast(authors: readonly string[], seed: number): Map<string, string> {
  const roster = authors.length <= EXPRESSIVE.length ? EXPRESSIVE : POOL;
  const castOf = new Map<string, string>();
  authors.forEach((a, i) => {
    const override = castOverrides.get(a);
    const namedCharacter = manifests[a] ? a : undefined;
    castOf.set(
      a,
      (override && manifests[override] ? override : undefined) ??
        namedCharacter ??
        roster[(i + seed) % roster.length]!,
    );
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
    else if (ev.kind === 'shout') kind = 'shout';
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
  for (const t of ['builder', 'script'] as const) {
    const el = $('tab-' + t);
    el.classList.toggle('is-active', tab === t);
    el.setAttribute('aria-selected', String(tab === t));
  }
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
  const title = titleValue();
  const subtitle = subtitleValue();
  // Never draw the layout guides into a saved image. A titled export gets the
  // credit line; a plain one stays clean.
  return renderStripSvg(currentPanels, renderOptions(false), {
    columns,
    title: title || undefined,
    subtitle: subtitle || undefined,
    credit: title || subtitle ? EXPORT_CREDIT : undefined,
  });
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
// Each seed procedurally generates a (near-always unique) comic — templates with
// randomized casts and filler, plus the occasional curated corpus gem. Same seed
// → same comic. See examples/generate.ts.
const conversationFor = (seed: number): string => generateConversation(seed);

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

// ---- Shareable permalinks -------------------------------------------------

// The whole comic — its script, seed, and scene — packs into the URL hash, so a
// composed strip can be bookmarked or shared and reopens exactly. The script is
// the canonical form (both tabs produce it); casting a participant named after a
// character (see resolveCast) is what makes it fully self-describing.

interface ShareState {
  s: string; // the script, in `name (hint): text` form
  seed: number;
  scene: string; // backdrop id, or '' for auto
  t?: string; // title
  st?: string; // subtitle
}

/** UTF-8-safe base64url, so scripts with punctuation/emoji survive the round-trip. */
function encodeState(state: ShareState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(token: string): ShareState | null {
  try {
    const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ShareState>;
    if (typeof parsed.s !== 'string') return null;
    return {
      s: parsed.s,
      seed: Number(parsed.seed) || 0,
      scene: typeof parsed.scene === 'string' ? parsed.scene : '',
      t: typeof parsed.t === 'string' ? parsed.t : '',
      st: typeof parsed.st === 'string' ? parsed.st : '',
    };
  } catch {
    return null;
  }
}

/** The current comic as shareable state — script from the active tab, plus seed & scene. */
function currentShareState(): ShareState {
  const script =
    activeTab === 'builder' ? builder.toScript() : ($('log') as HTMLTextAreaElement).value;
  return {
    s: script,
    seed: seedValue(),
    scene: ($('scene') as HTMLSelectElement).value,
    t: titleValue(),
    st: subtitleValue(),
  };
}

/** Write the current comic into the URL hash and copy the link to the clipboard. */
async function copyShareLink(): Promise<void> {
  const btn = $('share') as HTMLButtonElement;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent ?? 'Copy link';
  const flash = (msg: string): void => {
    btn.textContent = msg;
    setTimeout(() => (btn.textContent = btn.dataset.label!), 1600);
  };
  const state = currentShareState();
  if (!state.s.trim()) {
    flash('Nothing to share');
    return;
  }
  history.replaceState(null, '', '#c=' + encodeState(state));
  try {
    await navigator.clipboard.writeText(location.href);
    flash('Link copied ✓');
  } catch {
    flash('Link in address bar');
  }
}

/** If the URL carries a shared comic, load it into both surfaces. Returns true when it did. */
function loadFromHash(): boolean {
  const match = /[#&]c=([^&]+)/.exec(location.hash);
  if (!match) return false;
  const state = decodeState(match[1]!);
  if (!state || !state.s.trim()) return false;

  authored = true; // a shared comic is authored — the seed won't overwrite it
  castOverrides.clear();
  ($('seed') as HTMLInputElement).value = String(state.seed);
  ($('scene') as HTMLSelectElement).value = backdrops[state.scene] ? state.scene : '';
  ($('title') as HTMLInputElement).value = state.t ?? '';
  ($('subtitle') as HTMLInputElement).value = state.st ?? '';
  renderComicTitle();
  ($('log') as HTMLTextAreaElement).value = state.s;
  builder.load(rowsFromConversation(state.s, state.seed));
  return true;
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

// Title/subtitle are export metadata — they don't recompose, just update the echo.
for (const id of ['title', 'subtitle']) {
  $(id).addEventListener('input', renderComicTitle);
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
$('share').addEventListener('click', () => void copyShareLink());

// Pasting a share link into the address bar (a real hash change, not our own
// replaceState) opens that comic.
window.addEventListener('hashchange', () => {
  if (loadFromHash()) run();
});

// First paint: a shared comic from the URL if present, else the default corpus pick.
showCast(false);
if (!loadFromHash()) loadConversation(seedValue());
run();
