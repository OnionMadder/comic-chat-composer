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

const PANEL_W = 400;
const PANEL_H = 300;

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
  addressee: string; // character id, or '' for none
}

type LineKind = 'say' | 'think' | 'whisper' | 'shout' | 'action';

const state: AppState = { cast: [], events: [], speaker: '', scene: '', seed: 1 };
const pending: Pending = { kind: 'say', expression: 'neutral', intensity: 0, gesture: 'neutral', addressee: '' };

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
  const scene = Object.keys(backdrops)[seed % Object.keys(backdrops).length] ?? '';
  return { cast: castIds, events: mapped, scene };
}

// ---- Painting the comic ---------------------------------------------------

let currentPanels: Panel[] = [];

function paint(): void {
  const comic = $('comic');
  const castMap: Record<string, CastEntry> = {};
  for (const id of state.cast) castMap[id] = { characterId: id };

  const messages = state.events.filter((e) => e.type !== 'join').length;
  if (messages === 0) {
    currentPanels = [];
    comic.innerHTML = `<div class="empty"><p>Tap a character, type a line, hit send.</p>
      <p class="dim">Your conversation draws itself into a comic, panel by panel.</p></div>`;
    return;
  }

  const panels = compose({
    events: state.events,
    cast: castMap,
    characterAssets: manifests,
    backdrops: state.scene ? [state.scene] : Object.keys(backdrops),
    seed: state.seed,
    metrics: METRICS,
    rules: { panelWidth: PANEL_W, panelHeight: PANEL_H },
  });
  currentPanels = panels;

  const opts = renderOptions();
  comic.innerHTML = panels
    .map((p) => `<figure class="panel">${renderPanelToSvg(p, opts)}</figure>`)
    .join('');
  // Newest beat sits at the bottom, above the thumb.
  requestAnimationFrame(() => comic.scrollTo({ top: comic.scrollHeight, behavior: 'smooth' }));
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
  const others = state.cast.filter((id) => id !== state.speaker);
  ($('addressee') as HTMLSelectElement).innerHTML =
    `<option value="">to everyone</option>` +
    others.map((id) => `<option value="${id}"${id === pending.addressee ? ' selected' : ''}>to ${esc(castName(id, manifests[id]?.name))}</option>`).join('');
  updatePreview();
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

function send(): void {
  if (!state.speaker) return;
  const input = $('text') as HTMLInputElement;
  const text = input.value.trim();
  const addressees = pending.addressee ? [pending.addressee] : undefined;
  const at = state.events.length;

  if (!text) {
    // No words but a chosen pose → a wordless reaction, posed in place.
    if (pending.expression === 'neutral' && pending.gesture === 'neutral') return;
    state.events.push({
      type: 'reaction',
      author: state.speaker,
      expression: pending.expression === 'neutral' ? undefined : pending.expression,
      gesture: pending.gesture === 'neutral' ? undefined : pending.gesture,
      addressees,
      at,
    });
  } else {
    const type = pending.kind === 'action' ? 'action' : 'message';
    const kind: BalloonKind | undefined =
      pending.kind === 'think' ? 'thought' : pending.kind === 'whisper' ? 'whisper' : pending.kind === 'shout' ? 'shout' : undefined;
    state.events.push({
      type,
      author: state.speaker,
      text,
      addressees,
      kind,
      expressionOverride: pending.expression === 'neutral' ? undefined : pending.expression,
      gestureOverride: pending.gesture === 'neutral' ? undefined : pending.gesture,
      at,
    });
  }

  input.value = '';
  pending.expression = 'neutral';
  pending.intensity = 0;
  pending.gesture = 'neutral';
  pending.addressee = '';
  wheel.set({ emotion: 'neutral', intensity: 0 });
  advanceSpeaker();
  renderCast();
  renderTray();
  paint();
  input.focus();
}

function undo(): void {
  if (!state.events.length) return;
  state.events.pop();
  paint();
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
  paint();
}

// ---- Surprise -------------------------------------------------------------

function loadSeed(seed: number): void {
  state.seed = seed;
  const s = starter(seed);
  state.cast = s.cast;
  state.events = s.events;
  state.scene = s.scene;
  state.speaker = s.cast[0] ?? '';
  renderCast();
  renderTray();
  paint();
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
$('addressee').addEventListener('change', (e) => (pending.addressee = (e.target as HTMLSelectElement).value));
$('send').addEventListener('click', send);
$('text').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); send(); }
});
$('undo').addEventListener('click', undo);
$('dice').addEventListener('click', surprise);
$('sheet-close').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
$('sheet-body').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn?.dataset.pick) addCharacter(btn.dataset.pick);
});

// First paint: a fixed welcome comic, so the first launch is the same every
// time (the dice rerolls). Later this becomes the persisted last session.
loadSeed(7);
