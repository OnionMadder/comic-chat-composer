/**
 * mComic '96 — the chat-to-comic compose screen.
 *
 * You role-play a conversation on one device: pick a character, type, pick a
 * delivery/emotion, send — and the panel is composed and dropped onto the
 * vertical strip above the input. It's a messenger whose transcript is a comic.
 *
 * The heavy lifting is the library: `compose()` turns the running event list
 * into panels, `renderPanelToSvg()` draws each one. This file is only the UI
 * and the app state. `__MANIFESTS__` / `__SPRITES__` / `__BACKDROPS__` are
 * inlined at build time (see build.ts), so nothing is fetched at runtime.
 */

import { compose } from '../src/compose.ts';
import { isExpressive, type CharacterManifest } from '../src/manifest.ts';
import type {
  BalloonKind,
  CastEntry,
  ChatEvent,
  Expression,
  Gesture,
  Panel,
  Rules,
} from '../src/types.ts';
import { generateConversation } from '../examples/generate.ts';
import { parseLog } from '../examples/parse-log.ts';
import { isMessageEvent } from '../src/types.ts';
import { renderPanelToSvg, type RenderOptions } from '../examples/render-svg.ts';
import { createApproximateMetrics } from '../src/text.ts';
import { castName } from './cast-names.ts';
import { speakerColor } from './branding.ts';
import { createWheel, type WheelApi } from './wheel.ts';

declare const __MANIFESTS__: Record<string, CharacterManifest>;
declare const __SPRITES__: Record<string, Record<string, string>>;
declare const __BACKDROPS__: Record<string, string>;

const manifests = __MANIFESTS__;
const spritesByChar = __SPRITES__;
const backdrops = __BACKDROPS__;

// Portrait panels for a phone: tall enough to give a character real presence
// with the balloons stacked above, instead of a wide desktop strip where
// everyone shrinks to a speck.
// Square panels — matching the square Comic Chat backdrops exactly, so the scene
// fills the frame with no crop or stretch and there's real vertical room.
const PANEL_W = 400;
const PANEL_H = 400;

// Characters stand *in* the square scene (identity camera — see paint()): feet
// on the ground line like the original, filling the lower ~70% of the frame,
// with the balloons in the band above. Faithful, and it renders reliably.
const RENDER_CHAR_FRACTION = 0.72;
const RENDER_BASELINE = 1.0;

// Only the clean backdrops while we tune framing — the busy color rooms (Buck's
// poster museum, the den) fight the characters on a small screen.
const SCENES = ['room', 'field', 'pastoral'];

const RULES: Partial<Rules> = {
  panelWidth: PANEL_W,
  panelHeight: PANEL_H,
  // Up to three fit in a square scene without shrinking too far.
  maxCharactersPerPanel: 3,
  // Balloons in the top ~40%; characters stand below them.
  balloonRegionFraction: 0.4,
  establishingShots: 'off',
};

// Size balloons against a slightly wider advance than the default (which is
// tuned for Comic Sans). Comic Neue — the font we bundle and render — runs a
// hair wider on some strings, so this margin keeps balloon text off the panel
// edge on every device instead of clipping.
const METRICS = createApproximateMetrics({ advanceRatio: 0.7 });

// Expressive characters (seven emotion heads or multi-pose figures) first, so
// an inferred emotion actually shows; the single-pose avatars trail.
const ALL = Object.keys(manifests).sort();
const POOL = [
  ...ALL.filter((id) => isExpressive(manifests[id]!)),
  ...ALL.filter((id) => !isExpressive(manifests[id]!)),
];

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderOptions(): RenderOptions {
  return {
    characters: manifests,
    sprite: (src, cid) => spritesByChar[cid]?.[src] ?? '',
    backdrops,
    panelWidth: PANEL_W,
    panelHeight: PANEL_H,
    characterHeightFraction: RENDER_CHAR_FRACTION,
    characterBaselineFraction: RENDER_BASELINE,
    // Halo off: its zoom-nested filter is unreliable on device, and we render at
    // identity now anyway. A device-safe aura can come back later.
    halo: false,
  };
}

// ---- App state ------------------------------------------------------------

interface AppState {
  /** Cast on stage, in join order — colour follows the slot. */
  cast: string[];
  /** The running conversation, author = character id. */
  events: ChatEvent[];
  /** Who the next line is spoken by. */
  speaker: string;
  /** The one room this conversation happens in. */
  scene: string;
  seed: number;
}

// The pending delivery for the line being typed (reset after each send).
interface Pending {
  kind: LineKind;
  expression: Expression;
  /** Emotion-wheel radius, 0–1. Captured for future per-intensity art. */
  intensity: number;
  gesture: Gesture;
  /**
   * Character ids to include in this beat's panel as addressees — the composer
   * places every addressee in the panel alongside the speaker. Order matters
   * only cosmetically (first shown → primary reply direction).
   */
  addressees: string[];
}

type LineKind = 'say' | 'think' | 'whisper' | 'shout' | 'action';

const state: AppState = { cast: [], events: [], speaker: '', scene: '', seed: 1 };
const pending: Pending = { kind: 'say', expression: 'neutral', intensity: 0, gesture: 'neutral', addressees: [] };

// Panel index (== content-event index) currently being edited, or -1 = append.
// Panels map 1:1 to content events (message/action/reaction) because the event
// list is interleaved with breaks, so `contentEventIndex(N)` finds the event
// backing panel N in `state.events`.
let editingPanel = -1;

/** Returns state.events indices of every content event, in panel order. */
function contentEventIndices(): number[] {
  const out: number[] = [];
  state.events.forEach((e, i) => { if (isContentEvent(e)) out.push(i); });
  return out;
}

const colorOf = (id: string): string => speakerColor(Math.max(0, state.cast.indexOf(id)));

// The emotion wheel, wired to drive the pending pose + the live preview.
let wheel: WheelApi;

// ---- Composing a starter from a seed --------------------------------------

/** Resolve generic log authors to real characters, expressive first. */
function castFor(authors: readonly string[], seed: number): Map<string, string> {
  const expressive = POOL.filter((id) => isExpressive(manifests[id]!));
  const roster = authors.length <= expressive.length ? expressive : POOL;
  const map = new Map<string, string>();
  authors.forEach((a, i) => map.set(a, roster[(i + seed) % roster.length]!));
  return map;
}

const isContentEvent = (e: ChatEvent): boolean =>
  e.type === 'message' || e.type === 'action' || e.type === 'reaction';

/** Insert a `break` between every pair of content events, so panel i ↔ i-th beat. */
function interleaveBreaks(events: ChatEvent[]): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (last && isContentEvent(last) && isContentEvent(ev)) {
      out.push({ type: 'break', at: out.length });
    }
    out.push({ ...ev, at: out.length });
  }
  return out;
}

/** Turn a generated conversation into app events keyed by character id. */
function starter(seed: number): { cast: string[]; events: ChatEvent[]; scene: string } {
  const { events, authors } = parseLog(generateConversation(seed));
  const cast = castFor(authors, seed);
  const castIds = [...new Set(authors.map((a) => cast.get(a)!))];
  const mapped: ChatEvent[] = [];
  for (const ev of events) {
    if (!isMessageEvent(ev)) continue;
    const author = cast.get(ev.author)!;
    const addressees = ev.addressees?.map((a) => cast.get(a) ?? a).filter((a) => castIds.includes(a));
    mapped.push({ ...ev, author, addressees });
  }
  const scene = SCENES[seed % SCENES.length] ?? '';
  // One beat per panel from the start: break between every line, so tapping
  // panel N maps 1:1 to the N-th content event for editing.
  const withBreaks = interleaveBreaks(mapped);
  // Keep the opening comic short — three square panels on a phone, not a
  // scroll. Take the longest prefix of events that still composes to ≤ 3 panels.
  return { cast: castIds, events: capToPanels(withBreaks, castIds, scene, seed, 3), scene };
}

/** Panels a set of events composes to (for the given cast/scene/seed). */
function panelCountFor(events: ChatEvent[], castIds: string[], scene: string, seed: number): number {
  if (!events.some((e) => e.type !== 'join' && e.type !== 'break')) return 0;
  const castMap: Record<string, CastEntry> = {};
  for (const id of castIds) castMap[id] = { characterId: id };
  return compose({
    events,
    cast: castMap,
    characterAssets: manifests,
    backdrops: scene ? [scene] : Object.keys(backdrops),
    seed,
    metrics: METRICS,
    rules: RULES,
  }).length;
}

/** The longest leading run of events that still composes to at most `max` panels. */
function capToPanels(events: ChatEvent[], castIds: string[], scene: string, seed: number, max: number): ChatEvent[] {
  for (let k = 1; k <= events.length; k++) {
    if (panelCountFor(events.slice(0, k), castIds, scene, seed) > max) return events.slice(0, k - 1);
  }
  return events;
}

// ---- Painting the comic ---------------------------------------------------

let currentPanels: Panel[] = [];
// How many panels are already in the DOM. New lines only ever *append* beyond
// this, so an already-drawn panel is never re-rendered — the comic is a
// transcript, not a live-recomposed document.
let renderedCount = 0;

const EMPTY_HTML = `<div class="empty"><p>Tap a character, type a line, hit send.</p>
  <p class="dim">Your conversation draws itself into a comic, panel by panel.</p></div>`;

// Mobile render: flatten the §6.2 zoom camera to identity. The zoom transform
// (scale 2× on the character layer) is what some device Chromes refuse to
// paint; drawing characters at 1:1 like the live preview renders reliably.
const FLAT_CAMERA = { x: 0, y: 0, width: PANEL_W, height: PANEL_H, scale: 1 } as const;

/** Compose the whole event stream into panels. Deterministic for a fixed seed. */
function composePanels(): Panel[] {
  const hasContent = state.events.some((e) => e.type !== 'join' && e.type !== 'break');
  if (!hasContent) {
    currentPanels = [];
    return [];
  }
  const castMap: Record<string, CastEntry> = {};
  for (const id of state.cast) castMap[id] = { characterId: id };
  currentPanels = compose({
    events: state.events,
    cast: castMap,
    characterAssets: manifests,
    backdrops: state.scene ? [state.scene] : Object.keys(backdrops),
    seed: state.seed,
    metrics: METRICS,
    rules: RULES,
  });
  return currentPanels;
}

const panelHtml = (p: Panel, idx: number): string =>
  `<figure class="panel" data-panel-idx="${idx}">${renderPanelToSvg({ ...p, camera: FLAT_CAMERA }, renderOptions())}</figure>`;

const scrollToNewest = (): void => {
  const comic = $('comic');
  requestAnimationFrame(() => comic.scrollTo({ top: comic.scrollHeight, behavior: 'smooth' }));
};

/**
 * Full rebuild — fresh comic, undo, or an edit.
 *
 * - `'newest'`: scroll to the newest panel (the default; correct for send, undo,
 *   fresh seed).
 * - `'preserve'`: keep the current scroll position (correct for edits — the
 *   user is looking at panel N, we don't want to yank them to the bottom).
 */
function repaintAll(scroll: 'newest' | 'preserve' = 'newest'): void {
  const comic = $('comic');
  const savedTop = comic.scrollTop;
  const panels = composePanels();
  comic.innerHTML = panels.length ? panels.map((p, i) => panelHtml(p, i)).join('') : EMPTY_HTML;
  renderedCount = panels.length;
  if (editingPanel >= 0) highlightEditingPanel();
  if (!panels.length) return;
  if (scroll === 'preserve') comic.scrollTop = savedTop;
  else scrollToNewest();
}

/** Append only the panels a new line produced. Existing panels are untouched. */
function appendPanels(): void {
  const comic = $('comic');
  const panels = composePanels();
  if (renderedCount === 0) comic.innerHTML = ''; // clear the empty-state message
  for (let i = renderedCount; i < panels.length; i++) {
    comic.insertAdjacentHTML('beforeend', panelHtml(panels[i]!, i));
  }
  renderedCount = panels.length;
  if (panels.length) scrollToNewest();
}

function highlightEditingPanel(): void {
  const comic = $('comic');
  comic.querySelectorAll('.panel.is-editing').forEach((el) => el.classList.remove('is-editing'));
  if (editingPanel < 0) return;
  const el = comic.querySelector(`.panel[data-panel-idx="${editingPanel}"]`);
  el?.classList.add('is-editing');
  // No auto-scroll — the user tapped the panel they wanted; keep their view.
}

// ---- The compose bar ------------------------------------------------------

function renderCast(): void {
  const chips = state.cast
    .map((id) => {
      const active = id === state.speaker ? ' is-active' : '';
      return (
        `<button class="chip${active}" data-id="${id}" style="--c:${colorOf(id)}" ` +
        `aria-pressed="${id === state.speaker}">${esc(castName(id, manifests[id]?.name))}</button>`
      );
    })
    .join('');
  $('cast').innerHTML = chips + `<button class="chip add" id="add-char" aria-label="Add a character">+</button>`;
  const who = state.speaker ? castName(state.speaker, manifests[state.speaker]?.name) : '—';
  $('speaking').textContent = state.cast.length ? `${who} is speaking` : 'Add characters to begin';
}

function renderTray(): void {
  ($('kind') as HTMLSelectElement).value = pending.kind;
  ($('gesture') as HTMLSelectElement).value = pending.gesture;
  renderAddressees();
  updatePreview();
}

/**
 * Chip strip of every cast member except the current speaker. Tap a chip to
 * toggle whether that character is in the beat's panel — the composer places
 * every addressee alongside the speaker, so this is how you add characters
 * to the current panel.
 */
function renderAddressees(): void {
  const others = state.cast.filter((id) => id !== state.speaker);
  if (others.length === 0) {
    $('addressees').innerHTML = '';
    return;
  }
  const chips = others
    .map((id) => {
      const on = pending.addressees.includes(id);
      return (
        `<button class="chip addr${on ? ' is-on' : ''}" data-addr="${id}" ` +
        `style="--c:${colorOf(id)}" aria-pressed="${on}" title="Toggle in panel">` +
        `+ ${esc(castName(id, manifests[id]?.name))}</button>`
      );
    })
    .join('');
  $('addressees').innerHTML = chips;
}

function toggleAddressee(id: string): void {
  const i = pending.addressees.indexOf(id);
  if (i >= 0) pending.addressees.splice(i, 1);
  else pending.addressees.push(id);
  renderAddressees();
}

/**
 * Populate the edit-bar's speaker <select> with every cast member, with the
 * current speaker preselected. Changing it swaps the beat's author on Update.
 */
function renderEditSpeaker(): void {
  const sel = $('edit-speaker') as HTMLSelectElement;
  sel.innerHTML = state.cast
    .map((id) => {
      const label = castName(id, manifests[id]?.name);
      const selected = id === state.speaker ? ' selected' : '';
      return `<option value="${id}"${selected}>${esc(label)}</option>`;
    })
    .join('');
}

// ---- Live speaker preview -------------------------------------------------

/** Draw the active speaker on its own, in the pending pose (identity camera). */
function previewSvg(characterId: string, expression: Expression, gesture: Gesture): string {
  const panel: Panel = {
    panelIndex: 0,
    zoom: 'wide',
    camera: { x: 0, y: 0, width: PANEL_W, height: PANEL_H, scale: 1 },
    characters: [{ author: 'preview', characterId, x: PANEL_W / 2, facing: 'right', gesture, expression, poseVariant: 0 }],
    balloons: [],
    backdrop: '',
  };
  return renderPanelToSvg(panel, renderOptions());
}

/** Repaint the preview to the current speaker + pending pose. */
function updatePreview(): void {
  if (!state.speaker || !$('tray').classList.contains('open')) return;
  $('preview').innerHTML = previewSvg(state.speaker, pending.expression, pending.gesture);
}

/** Advance to the next speaker after a line — the reply, for a chat feel. */
function advanceSpeaker(): void {
  if (state.cast.length < 2) return;
  const i = state.cast.indexOf(state.speaker);
  state.speaker = state.cast[(i + 1) % state.cast.length]!;
}

/** Build a content event from the compose bar. Returns null if nothing to send. */
function pendingEvent(at: number): ChatEvent | null {
  const text = ($('text') as HTMLInputElement).value.trim();
  // Filter out the speaker if they somehow ended up in the list (shouldn't
  // happen — the picker excludes them — but events must never self-address).
  const list = pending.addressees.filter((a) => a && a !== state.speaker);
  const addressees = list.length ? list : undefined;
  if (!text && pending.expression === 'neutral' && pending.gesture === 'neutral') return null;
  if (!text) {
    return {
      type: 'reaction',
      author: state.speaker,
      expression: pending.expression === 'neutral' ? undefined : pending.expression,
      gesture: pending.gesture === 'neutral' ? undefined : pending.gesture,
      addressees,
      at,
    };
  }
  const type = pending.kind === 'action' ? 'action' : 'message';
  const kind: BalloonKind | undefined =
    pending.kind === 'think' ? 'thought' : pending.kind === 'whisper' ? 'whisper' : pending.kind === 'shout' ? 'shout' : undefined;
  return {
    type,
    author: state.speaker,
    text,
    addressees,
    kind,
    expressionOverride: pending.expression === 'neutral' ? undefined : pending.expression,
    gestureOverride: pending.gesture === 'neutral' ? undefined : pending.gesture,
    at,
  };
}

function resetComposer(): void {
  ($('text') as HTMLInputElement).value = '';
  pending.expression = 'neutral';
  pending.intensity = 0;
  pending.gesture = 'neutral';
  pending.addressees = [];
  pending.kind = 'say';
  wheel.set({ emotion: 'neutral', intensity: 0 });
}

function send(): void {
  if (editingPanel >= 0) return updateLine();
  if (!state.speaker) return;
  const input = $('text') as HTMLInputElement;
  const ev = pendingEvent(state.events.length);
  if (!ev) return;

  // Close the previous panel so this line starts its own — an already-drawn
  // panel never recomposes when the next line arrives.
  const last = state.events[state.events.length - 1];
  if (last && last.type !== 'break') state.events.push({ type: 'break', at: state.events.length });
  ev.at = state.events.length;
  state.events.push(ev);

  resetComposer();
  advanceSpeaker();
  renderCast();
  renderTray();
  appendPanels();
  input.focus();
}

function undo(): void {
  if (!state.events.length) return;
  if (editingPanel >= 0) exitEditMode();
  state.events.pop(); // the line
  // ...and the break that preceded it, so we don't leave a dangling separator.
  while (state.events.length && state.events[state.events.length - 1]!.type === 'break') {
    state.events.pop();
  }
  repaintAll();
}

// ---- Editing an existing panel --------------------------------------------

/** Load a beat into the compose bar and enter edit mode for that panel. */
function enterEditMode(panelIdx: number): void {
  const indices = contentEventIndices();
  const evIdx = indices[panelIdx];
  if (evIdx === undefined) return;
  const ev = state.events[evIdx]!;

  editingPanel = panelIdx;

  if ('author' in ev) state.speaker = ev.author;

  const input = $('text') as HTMLInputElement;
  if (ev.type === 'reaction') {
    pending.kind = 'say';
    pending.expression = ev.expression ?? 'neutral';
    pending.gesture = ev.gesture ?? 'neutral';
    pending.addressees = [...(ev.addressees ?? [])];
    input.value = '';
  } else {
    pending.kind = ev.type === 'action' ? 'action' :
      ev.kind === 'thought' ? 'think' :
      ev.kind === 'whisper' ? 'whisper' :
      ev.kind === 'shout' ? 'shout' : 'say';
    pending.expression = ev.expressionOverride ?? 'neutral';
    pending.gesture = ev.gestureOverride ?? 'neutral';
    pending.addressees = [...(ev.addressees ?? [])];
    input.value = ev.text;
  }
  // No intensity is stored on events — show the wheel in the picked emotion at
  // a mid detente so it reads as "set", not neutral.
  pending.intensity = pending.expression === 'neutral' ? 0 : 0.7;
  wheel.set({ emotion: pending.expression, intensity: pending.intensity });

  $('tray').classList.add('open');
  $('edit-bar').classList.add('open');
  $('edit-label').textContent = `Editing panel ${panelIdx + 1}`;
  $('send').classList.add('is-update');
  $('send').setAttribute('aria-label', 'Update');
  renderCast();
  renderTray();
  renderEditSpeaker();
  highlightEditingPanel();
  input.focus();
}

function exitEditMode(): void {
  editingPanel = -1;
  $('comic').querySelectorAll('.panel.is-editing').forEach((el) => el.classList.remove('is-editing'));
  $('edit-bar').classList.remove('open');
  $('send').classList.remove('is-update');
  $('send').setAttribute('aria-label', 'Send');
  resetComposer();
  renderTray();
}

function updateLine(): void {
  if (editingPanel < 0) return;
  const indices = contentEventIndices();
  const evIdx = indices[editingPanel];
  if (evIdx === undefined) { exitEditMode(); return; }
  const at = state.events[evIdx]!.at;
  const next = pendingEvent(at);
  if (!next) return; // nothing to save; keep edit mode open
  state.events[evIdx] = next;
  exitEditMode();
  repaintAll('preserve');
}

function deleteLine(): void {
  if (editingPanel < 0) return;
  const indices = contentEventIndices();
  const evIdx = indices[editingPanel];
  if (evIdx === undefined) { exitEditMode(); return; }
  state.events.splice(evIdx, 1);
  // Collapse any doubled-up breaks left behind, and trim leading/trailing breaks.
  const compact: ChatEvent[] = [];
  for (const ev of state.events) {
    if (ev.type === 'break' && compact[compact.length - 1]?.type === 'break') continue;
    compact.push(ev);
  }
  while (compact[0]?.type === 'break') compact.shift();
  while (compact[compact.length - 1]?.type === 'break') compact.pop();
  state.events = compact;
  exitEditMode();
  repaintAll('preserve');
}

// ---- Cast picker sheet ----------------------------------------------------

function openCharPicker(): void {
  const grid = POOL.map(
    (id) => `<button class="pick" data-pick="${id}" ${state.cast.includes(id) ? 'disabled' : ''}>
      <span class="pick-name">${esc(castName(id, manifests[id]?.name))}</span></button>`,
  ).join('');
  $('sheet-body').innerHTML = grid;
  $('sheet').classList.add('open');
}
function closeSheet(): void {
  $('sheet').classList.remove('open');
}
function addCharacter(id: string): void {
  if (state.cast.includes(id)) return;
  state.cast.push(id);
  if (!state.speaker) state.speaker = id;
  closeSheet();
  renderCast();
  renderTray();
  // No repaint: adding a character to the cast doesn't change any drawn panel —
  // they only appear once they speak, in a new panel.
}

// ---- Surprise -------------------------------------------------------------

function loadSeed(seed: number): void {
  state.seed = seed;
  const s = starter(seed);
  state.cast = s.cast;
  state.events = s.events;
  state.scene = s.scene;
  state.speaker = s.cast[0] ?? '';
  if (editingPanel >= 0) exitEditMode();
  renderCast();
  renderTray();
  repaintAll();
}

function surprise(): void {
  loadSeed(Math.floor(1 + Math.random() * 99999));
}

// ---- Wire up --------------------------------------------------------------

$('cast').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  if (btn.id === 'add-char') return openCharPicker();
  const id = btn.dataset.id;
  if (id) {
    state.speaker = id;
    renderCast();
    renderTray();
    ($('text') as HTMLInputElement).focus();
  }
});

wheel = createWheel($('wheel'), (v) => {
  pending.expression = v.emotion;
  pending.intensity = v.intensity;
  updatePreview();
});

$('more').addEventListener('click', () => {
  $('tray').classList.toggle('open');
  updatePreview();
});
$('kind').addEventListener('change', (e) => (pending.kind = (e.target as HTMLSelectElement).value as LineKind));
$('gesture').addEventListener('change', (e) => {
  pending.gesture = (e.target as HTMLSelectElement).value as Gesture;
  updatePreview();
});
$('addressees').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button.addr') as HTMLElement | null;
  if (!btn) return;
  const id = btn.dataset.addr;
  if (id) toggleAddressee(id);
});
$('send').addEventListener('click', send);
$('text').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); send(); }
});
$('undo').addEventListener('click', undo);
$('dice').addEventListener('click', surprise);

// Tap a panel to edit that beat. Tap the same panel again to cancel.
$('comic').addEventListener('click', (e) => {
  const fig = (e.target as HTMLElement).closest('figure.panel') as HTMLElement | null;
  if (!fig) return;
  const idx = Number(fig.dataset.panelIdx);
  if (!Number.isFinite(idx)) return;
  if (editingPanel === idx) exitEditMode();
  else enterEditMode(idx);
});
$('edit-cancel').addEventListener('click', exitEditMode);
$('edit-delete').addEventListener('click', deleteLine);
$('edit-speaker').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value;
  if (!id) return;
  state.speaker = id;
  // A message can't address its own speaker — drop the new speaker from the
  // addressee list if they were on it before the swap.
  pending.addressees = pending.addressees.filter((a) => a !== id);
  // A speaker swap can add/remove a chip from the addressee strip, so re-
  // render both surfaces.
  renderCast();
  renderTray();
  updatePreview();
});

$('sheet-close').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
$('sheet-body').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn?.dataset.pick) addCharacter(btn.dataset.pick);
});

// First paint: a fixed welcome comic, so the first launch is the same every
// time (the dice rerolls). Later this becomes the persisted last session.
loadSeed(7);
