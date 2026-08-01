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
  MessageEvent,
  Panel,
  ReactionEvent,
  Rules,
} from '../src/types.ts';
import { generateConversation } from '../examples/generate.ts';
import { parseLog } from '../examples/parse-log.ts';
import { isMessageEvent } from '../src/types.ts';
import { renderPanelToSvg, type RenderOptions } from '../examples/render-svg.ts';
import { renderStripSvg } from '../examples/strip.ts';
import { createApproximateMetrics } from '../src/text.ts';
import { castName } from './cast-names.ts';
import { speakerColor } from './branding.ts';
import { createWheel, type WheelApi } from './wheel.ts';
import {
  autoName,
  deleteDraft,
  getCurrentId,
  listDrafts,
  loadDraft,
  migrateLegacySession,
  newDraftId,
  saveDraft,
  setCurrentId,
  type SavedComic,
} from './storage.ts';

declare const __MANIFESTS__: Record<string, CharacterManifest>;
declare const __SPRITES__: Record<string, Record<string, string>>;
declare const __BACKDROPS__: Record<string, string>;
declare const __FONT_CSS__: string;

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
  // No solo-panel roll. §6.1 rolls a small chance that a long opening line gets
  // a panel to itself, and a solo panel drops its addressees (`addToState` in
  // compose.ts skips them when `solo`). Here every beat already *is* its own
  // panel, so the roll's intended effect is unconditionally true already and
  // the only thing left is the side effect: a character the author explicitly
  // added to the frame silently not appearing. Deterministically, too — same
  // seed, same roll — so the affected panel refuses that character every time.
  // An authoring tool must not overrule an explicit instruction with a dice roll.
  soloPanelProbability: 0,
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

/**
 * The three v2.5 colour avatars. They're fully saturated against a cast that is
 * otherwise flat black-and-white line art, so one of them dropped into a random
 * starter pulls the whole panel toward itself.
 *
 * They stay in the `+` picker — they're good art and worth choosing on purpose.
 * They're just kept out of the seed roll's casting, so an unasked-for comic
 * looks like Comic Chat instead of like a cartoon crashed into it.
 */
const LOUD = new Set(['buck', 'kirby', 'veronica']);
const CASTABLE = POOL.filter((id) => !LOUD.has(id));

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

/**
 * Per-beat character overrides — applied AFTER the composer produces panels,
 * so the library stays pixel-free and its placement algorithm untouched.
 *
 * Keyed by the content event's `at` (monotonic, preserved through edits,
 * duplication, reorder). Only stores what deviates from the default:
 *   - `facing`: characterId → 'left' | 'right' (flip a character's direction)
 *   - `order`:  characterId[] (left-to-right sequence, x-positions preserved)
 */
interface BeatOverrides {
  facing?: Record<string, 'left' | 'right'>;
  order?: string[];
}
const overrides = new Map<number, BeatOverrides>();

// Panel index (== content-event index) currently being edited, or -1 = append.
// Panels map 1:1 to content events (message/action/reaction) because the event
// list is interleaved with breaks, so `contentEventIndex(N)` finds the event
// backing panel N in `state.events`.
let editingPanel = -1;

/**
 * Which beat *within* the edited panel is loaded in the compose bar.
 *
 * A panel can hold an exchange now, so "the panel being edited" is no longer
 * enough to identify a line. Always 0 for a single-line panel.
 */
let editingLine = 0;

/**
 * The comic as panels-worth of beats: each entry is one panel's content events,
 * in order.
 *
 * A panel is a **run of content events with no `break` between them** — which is
 * how the composer has always grouped them; the app just used to force a break
 * after every single beat, capping every panel at one balloon. Splitting on
 * breaks here is what lets a panel hold a whole exchange.
 *
 * `panelGroups()[i]` is panel `i`. That correspondence holds because an explicit
 * break *always* ends a panel in `compose()`, so a group can never span one —
 * it can only be split by the composer, which `reconcileGroups()` repairs.
 */
function panelGroups(): ChatEvent[][] {
  const groups: ChatEvent[][] = [];
  let current: ChatEvent[] = [];
  for (const ev of state.events) {
    if (ev.type === 'break') {
      if (current.length) groups.push(current);
      current = [];
    } else if (isContentEvent(ev)) {
      current.push(ev);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/** The beats of the panel being edited, or `[]` when not editing. */
function editingGroup(): ChatEvent[] {
  if (editingPanel < 0) return [];
  return panelGroups()[editingPanel] ?? [];
}

/** The specific beat loaded in the compose bar, or null. */
function editingEvent(): ChatEvent | null {
  return editingGroup()[editingLine] ?? null;
}

/** Distinct speakers already talking in a group (one balloon each per panel). */
function speakersIn(group: readonly ChatEvent[]): string[] {
  const out: string[] = [];
  for (const ev of group) {
    if (ev.type === 'break') continue;
    const who = (ev as MessageEvent | ReactionEvent).author;
    if (who && !out.includes(who)) out.push(who);
  }
  return out;
}

/**
 * Rewrite `state.events` from a new list of panel groups. `next` is the desired
 * panels in order, each one the beats that share it; every beat is either an
 * existing content event (its `at` is preserved — it's the overrides key) or a
 * brand-new one. Breaks are re-interleaved *between* groups, so panel N ↔
 * group N stays true.
 *
 * This is the single writer. Every mutating verb — reorder, duplicate, insert,
 * delete, add-a-line — reduces to "compute the new grouping and hand it here",
 * which is what keeps the invariant from drifting. Empty groups are dropped, so
 * deleting a panel's last line removes the panel.
 */
function rebuildEvents(next: ChatEvent[][]): void {
  const out: ChatEvent[] = [];
  next.filter((g) => g.length > 0).forEach((group, i) => {
    // A break goes BETWEEN panels, never inside one — the beats within a group
    // are what share a panel and give it more than one balloon.
    if (i > 0) out.push({ type: 'break', at: -1 });
    out.push(...group);
  });
  // Renumber the break `at` fields so they stay monotonic relative to the
  // content events that surround them. Content events keep their own `at`
  // (durable identity — used as the key for the overrides sidecar in §2).
  let maxAt = 0;
  for (const e of out) if (e.type !== 'break') maxAt = Math.max(maxAt, e.at);
  let bumper = maxAt + 1;
  for (const e of out) if (e.type === 'break' && e.at === -1) e.at = bumper++;
  state.events = out;
}

/** The next monotonic `at` for a freshly-minted content event. */
function nextAt(): number {
  let m = 0;
  for (const e of state.events) if (e.at > m) m = e.at;
  return m + 1;
}

const colorOf = (id: string): string => speakerColor(Math.max(0, state.cast.indexOf(id)));

// The emotion wheel, wired to drive the pending pose + the live preview.
let wheel: WheelApi;

// ---- Composing a starter from a seed --------------------------------------

/** Resolve generic log authors to real characters, expressive first. */
function castFor(authors: readonly string[], seed: number): Map<string, string> {
  // Note the roster is CASTABLE, not POOL: the index is `(i + seed) % length`,
  // which draws uniformly, so merely sorting the loud avatars to the back would
  // not make them any rarer. They have to be off the roster entirely.
  const expressive = CASTABLE.filter((id) => isExpressive(manifests[id]!));
  const roster = authors.length <= expressive.length ? expressive : CASTABLE;
  const map = new Map<string, string>();
  authors.forEach((a, i) => map.set(a, roster[(i + seed) % roster.length]!));
  return map;
}

const isContentEvent = (e: ChatEvent): boolean =>
  e.type === 'message' || e.type === 'action' || e.type === 'reaction';

/**
 * Pack consecutive lines into shared panels, the way a comic actually reads —
 * a back-and-forth lands in one frame rather than one line per panel.
 *
 * Greedy, and bounded by the composer's own rules so the grouping survives
 * `compose()` intact: a panel takes a new line only while that speaker hasn't
 * already spoken in it (one balloon per character per panel) and the panel is
 * under the character cap.
 */
function groupIntoExchanges(
  events: ChatEvent[],
  castIds: string[],
  scene: string,
  seed: number,
): ChatEvent[] {
  let groups = packGreedily(events);

  // Then verify against the composer and back off where it can't deliver.
  //
  // Packing by speaker count alone is not enough: three wordy lines overflow the
  // balloon band of a 400×400 panel, and the composer's answer is to **drop the
  // balloons it can't place** rather than split the panel. Unchecked, that blanked
  // a panel in 7% of seeds — one rendered seven written lines as a single balloon.
  //
  // It also has to be checked *in context*, not group by group: composing a group
  // alone gives a different answer than composing it after everything before it,
  // which is why an isolation check only got the failures down to 5%.
  for (let pass = 0; pass < 8; pass++) {
    const flat = flattenGroups(groups);
    const panels = panelsFor(flat, castIds, scene, seed);
    let bad = -1;
    if (panels.length !== groups.length) {
      // The composer split something; break up the first group that could be it.
      bad = groups.findIndex((g) => g.length > 1);
    } else {
      for (let i = 0; i < groups.length; i++) {
        const spoken = groups[i]!.filter((e) => e.type === 'message' || e.type === 'action').length;
        if (panels[i]!.balloons.length < spoken && groups[i]!.length > 1) { bad = i; break; }
      }
    }
    if (bad < 0) return flat;
    // Peel the first beat off the offending group and re-check. Each pass adds a
    // group, so this converges on one-beat-per-panel in the worst case.
    groups.splice(bad, 1, [groups[bad]![0]!], groups[bad]!.slice(1));
  }
  return flattenGroups(groups);
}

/** Pack consecutive beats while the speaker is new and the panel's cast fits. */
function packGreedily(events: ChatEvent[]): ChatEvent[][] {
  const cap = RULES.maxCharactersPerPanel ?? 3;
  const groups: ChatEvent[][] = [];
  let current: ChatEvent[] = [];
  for (const ev of events) {
    const who = (ev as MessageEvent | ReactionEvent).author;
    // Everyone the beat needs in frame, not just the speaker — a line addressed
    // to someone drags them into the panel and counts against the cap.
    const needed = new Set(
      [...current, ev].flatMap((e) => [
        (e as MessageEvent | ReactionEvent).author,
        ...((e as MessageEvent).addressees ?? []),
      ]),
    );
    const repeatSpeaker = current.some((e) => (e as MessageEvent | ReactionEvent).author === who);
    if (current.length > 0 && (repeatSpeaker || needed.size > cap)) {
      groups.push(current);
      current = [];
    }
    current.push(ev);
  }
  if (current.length) groups.push(current);
  return groups;
}

function flattenGroups(groups: ChatEvent[][]): ChatEvent[] {
  const out: ChatEvent[] = [];
  groups.forEach((group, i) => {
    if (i > 0) out.push({ type: 'break', at: out.length });
    for (const ev of group) out.push({ ...ev, at: out.length });
  });
  return out;
}

/** Compose a candidate event list with the app's cast/scene/seed. */
function panelsFor(events: ChatEvent[], castIds: string[], scene: string, seed: number): Panel[] {
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
  });
}

/**
 * How many panels a fresh comic opens with.
 *
 * Was 3 back when every line got its own panel — which quietly meant the
 * opening comic was the first *three lines* of an eight-line scene, cut off
 * before the punchline every single time. Grouped into exchanges, four panels
 * hold a whole conversation.
 */
const OPENING_PANELS = 4;

/** Turn a generated conversation into app events keyed by character id. */
function starter(seed: number): { cast: string[]; events: ChatEvent[]; scene: string } {
  // `tune: false` — the demo pads scripts with generic closing beats to hit its
  // 2×3 grid. The app paces itself by grouping, so it wants the script the
  // template actually wrote, ending on its own punchline.
  const { events, authors } = parseLog(generateConversation(seed, { tune: false }));
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
  const grouped = groupIntoExchanges(mapped, castIds, scene, seed);
  return {
    cast: castIds,
    events: capToPanels(grouped, castIds, scene, seed, OPENING_PANELS),
    scene,
  };
}

/** Panels a set of events composes to (for the given cast/scene/seed). */
function panelCountFor(events: ChatEvent[], castIds: string[], scene: string, seed: number): number {
  if (!events.some((e) => e.type !== 'join' && e.type !== 'break')) return 0;
  return panelsFor(events, castIds, scene, seed).length;
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
  let raw = composeRaw();
  // Panel N must stay pinned to group N, or every editing verb targets the
  // wrong beat. Repair first, then apply overrides against a mapping we trust.
  if (raw.length !== panelGroups().length && reconcileGroups(raw)) raw = composeRaw();
  currentPanels = applyBeatOverrides(raw);
  return currentPanels;
}

function composeRaw(): Panel[] {
  const castMap: Record<string, CastEntry> = {};
  for (const id of state.cast) castMap[id] = { characterId: id };
  return compose({
    events: state.events,
    cast: castMap,
    characterAssets: manifests,
    backdrops: state.scene ? [state.scene] : Object.keys(backdrops),
    seed: state.seed,
    metrics: METRICS,
    rules: RULES,
  });
}

/**
 * Restore the panel↔group correspondence when the composer split a group.
 *
 * An explicit `break` always ends a panel, so a group can never span one — it
 * can only be split, which means `panels.length >= groups.length` and each
 * group maps to a contiguous run of panels. The UI prevents the deterministic
 * causes (a repeat speaker, or exceeding the character cap), leaving only
 * layout failure on very long text.
 *
 * When it does happen, walk the panels consuming each group's speakers and
 * write a real `break` where the composer actually divided things. The line
 * visibly becomes its own panel — honest, and far better than a silently
 * mismatched mapping that would send edits to the wrong beat.
 *
 * Returns whether anything changed.
 */
function reconcileGroups(panels: Panel[]): boolean {
  const groups = panelGroups();
  if (panels.length <= groups.length) return false;

  // Match on BALLOONS, not on who is in frame. A character can stand in a panel
  // as an addressee while their own line lands in a later one, so presence says
  // nothing about where an utterance ended up — its balloon does.
  const unclaimed = panels.map((p) => p.balloons.map((b) => b.speaker));

  const rebuilt: ChatEvent[][] = [];
  let p = 0;
  for (const group of groups) {
    let chunk: ChatEvent[] = [];
    for (const ev of group) {
      const who = (ev as MessageEvent | ReactionEvent).author;
      let fits: boolean;
      if (ev.type === 'reaction') {
        // No balloon to match; a reaction rides in whichever panel draws it.
        fits = !panels[p] || panels[p]!.characters.some((c) => c.author === who);
      } else {
        const slot = unclaimed[p]?.indexOf(who) ?? -1;
        if (slot >= 0) unclaimed[p]!.splice(slot, 1);
        fits = slot >= 0;
      }
      if (!fits && chunk.length > 0) {
        rebuilt.push(chunk);
        chunk = [];
        p++;
        // Re-try this beat against the panel we just advanced to.
        const slot = unclaimed[p]?.indexOf(who) ?? -1;
        if (slot >= 0) unclaimed[p]!.splice(slot, 1);
      }
      chunk.push(ev);
    }
    if (chunk.length) rebuilt.push(chunk);
    p++;
  }
  if (rebuilt.length === groups.length) return false;
  rebuildEvents(rebuilt);
  return true;
}

/**
 * Overlay per-beat character overrides onto the composed panels. Applies
 * `order` (rearranges left↔right, preserving the composer's x-spacing) and
 * `facing` (flips a character's direction). Balloon tails follow the
 * speaker's new x so tails don't point at empty air.
 */
function applyBeatOverrides(panels: Panel[]): Panel[] {
  const groups = panelGroups();
  return panels.map((p, i) => {
    // Keyed off the group's FIRST beat: where characters stand is a property of
    // the panel, not of any one line in it, so it must stay put no matter which
    // line you edit.
    const ev = groups[i]?.[0];
    if (!ev) return p;
    const ov = overrides.get(ev.at);
    if (!ov || (!ov.facing && !ov.order)) return p;

    let chars = p.characters.map((c) => ({ ...c }));

    if (ov.order && ov.order.length && chars.length > 1) {
      // Preserve the composer's chosen x-positions (they respect §4.3
      // spacing); we only permute WHICH character sits at each one.
      const xs = chars.map((c) => c.x).sort((a, b) => a - b);
      const byId = new Map(chars.map((c) => [c.characterId, c]));
      const reordered: typeof chars = [];
      for (const id of ov.order) {
        const c = byId.get(id);
        if (c && !reordered.includes(c)) reordered.push(c);
      }
      for (const c of chars) if (!reordered.includes(c)) reordered.push(c);
      reordered.forEach((c, k) => { c.x = xs[k]!; });
      chars = reordered;
    }

    if (ov.facing) {
      for (const c of chars) {
        const f = ov.facing[c.characterId];
        if (f) c.facing = f;
      }
    }

    const balloons = p.balloons.map((b) => {
      const speaker = chars.find((c) => c.author === b.speaker);
      if (!speaker || !b.tail) return b;
      return { ...b, tail: { ...b.tail, toX: speaker.x } };
    });

    return { ...p, characters: chars, balloons };
  });
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
  // The edit bar's speaker menu is the same cast list in another shape, so it
  // refreshes here rather than only when edit mode opens — otherwise adding a
  // character mid-edit leaves them missing from the menu until you reopen it.
  renderEditSpeaker();
}

const KINDS: readonly LineKind[] = ['say', 'think', 'whisper', 'shout', 'action'];
const GESTURES: readonly Gesture[] = ['neutral', 'wave', 'point-self', 'point-other', 'smile', 'shrug'];

function renderTray(): void {
  renderKindChips();
  renderGestureChips();
  renderAddressees();
  updatePreview();
}

/** Delivery chip strip — one tap sets `pending.kind`. */
function renderKindChips(): void {
  $('kind-chips').innerHTML = KINDS
    .map((k) => {
      const on = k === pending.kind;
      return (
        `<button class="pickchip${on ? ' is-on' : ''}" data-kind="${k}" ` +
        `role="radio" aria-checked="${on}">${k}</button>`
      );
    })
    .join('');
}

/** Gesture chip strip — one tap sets `pending.gesture`. */
function renderGestureChips(): void {
  $('gesture-chips').innerHTML = GESTURES
    .map((g) => {
      const on = g === pending.gesture;
      return (
        `<button class="pickchip${on ? ' is-on' : ''}" data-gesture="${g}" ` +
        `role="radio" aria-checked="${on}">${g}</button>`
      );
    })
    .join('');
}

/**
 * Chip strip of every cast member except the current speaker. Tap a chip to
 * toggle whether that character is in the beat's panel — the composer places
 * every addressee alongside the speaker, so this is how you add characters
 * to the current panel.
 */
function renderAddressees(): void {
  // While editing, the edit bar's "in this panel" row is the same control in a
  // better place — don't show two of them.
  $('addressees-row').classList.toggle('is-hidden', editingPanel >= 0);
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
 * In-scene character chip strip: one chip per character currently in the
 * edited panel, in left-to-right order. Each chip has ‹ / › nudge buttons
 * to swap position with a neighbor, and the name itself flips facing.
 * Only visible during edit mode; changes write to the overrides sidecar
 * and repaint immediately.
 */
/**
 * "In this panel" — every cast member as an in/out toggle for the beat being
 * edited.
 *
 * A single-beat panel contains exactly its speaker plus the people that beat
 * addresses, so putting someone in frame and directing the line at them are the
 * same act. This is that one act, in the edit bar where you can see it, rather
 * than buried at the bottom of the collapsed tray as "also in panel".
 */
function renderPanelCast(): void {
  const host = $('panel-cast');
  if (editingPanel < 0) { host.innerHTML = ''; return; }
  const chips = state.cast
    .map((id) => {
      const name = esc(castName(id, manifests[id]?.name));
      if (id === state.speaker) {
        // The speaker is always in their own panel — shown for context, locked,
        // and changed through the speaker menu instead.
        return (
          `<span class="pcast is-speaker" style="--c:${colorOf(id)}" ` +
          `title="${name} is speaking in this panel">&#9679; ${name}</span>`
        );
      }
      const on = pending.addressees.includes(id);
      return (
        `<button class="pcast${on ? ' is-on' : ''}" data-member="${id}" ` +
        `style="--c:${colorOf(id)}" aria-pressed="${on}" ` +
        `aria-label="${on ? 'Remove' : 'Add'} ${name} ${on ? 'from' : 'to'} this panel">` +
        `${on ? '&#10003;' : '&#43;'} ${name}</button>`
      );
    })
    .join('');
  host.innerHTML =
    chips +
    `<button class="pcast add" id="panel-cast-add" aria-label="Add a new character to this panel">&#43;&hellip;</button>`;
}

/**
 * The "lines" row: one chip per beat sharing this panel, plus "+ line".
 *
 * A panel holds an exchange now, so this is how you say which line you're
 * editing — and how you give a newly-added character something to say, which
 * was impossible while every panel was capped at a single beat.
 */
function renderLineChips(): void {
  const host = $('line-chips');
  const row = $('lines-row');
  if (editingPanel < 0) {
    host.innerHTML = '';
    row.classList.remove('is-shown');
    return;
  }
  const group = editingGroup();
  const speaking = speakersIn(group);
  // Every character already in frame is a candidate voice; the cap is the
  // composer's own (one balloon per character, `maxCharactersPerPanel` total).
  const canAdd =
    speaking.length < (RULES.maxCharactersPerPanel ?? 3) &&
    availableVoices(group).length > 0;

  const chips = group
    .map((ev, i) => {
      const who = (ev as MessageEvent | ReactionEvent).author ?? '';
      const name = esc(castName(who, manifests[who]?.name));
      const on = i === editingLine;
      return (
        `<button class="pcast line${on ? ' is-on' : ''}" data-line="${i}" ` +
        `style="--c:${colorOf(who)}" aria-pressed="${on}" ` +
        `aria-label="Edit line ${i + 1}, ${name}">${i + 1} &#9679; ${name}</button>`
      );
    })
    .join('');

  const addTitle = canAdd
    ? 'Add another line to this panel'
    : 'This panel is full — every character in it already has a line';
  host.innerHTML =
    chips +
    `<button class="pcast add" id="line-add" ${canAdd ? '' : 'disabled'} ` +
    `title="${addTitle}" aria-label="${addTitle}">&#43; line</button>`;
  // A single-line panel needs no line picker — keep simple panels simple. It
  // still shows when there is room to add one, since that's the whole point.
  row.classList.toggle('is-shown', group.length > 1 || canAdd);
}

/**
 * Characters who could take a new line in this panel: in frame, not already
 * speaking. The composer allows only one balloon per character per panel, so
 * offering a repeat speaker would just cause it to split the panel.
 */
function availableVoices(group: readonly ChatEvent[]): string[] {
  const speaking = speakersIn(group);
  const inFrame = new Set<string>(speaking);
  for (const ev of group) {
    for (const a of (ev as MessageEvent | ReactionEvent).addressees ?? []) inFrame.add(a);
  }
  // Prefer people already in the panel; fall back to the rest of the cast so a
  // one-character panel can still grow into a conversation.
  const fromFrame = [...inFrame].filter((id) => !speaking.includes(id));
  return fromFrame.length ? fromFrame : state.cast.filter((id) => !speaking.includes(id));
}

/** Append a new line to the edited panel and open it for typing. */
function addLineToPanel(): void {
  if (editingPanel < 0) return;
  const groups = panelGroups();
  const group = groups[editingPanel];
  if (!group) return;
  const voice = availableVoices(group)[0];
  if (!voice) return;

  // Address it back at whoever spoke first, so the two actually face each other.
  const firstSpeaker = speakersIn(group)[0];
  const beat: ChatEvent = {
    type: 'message',
    author: voice,
    text: '',
    addressees: firstSpeaker && firstSpeaker !== voice ? [firstSpeaker] : undefined,
    at: nextAt(),
  };
  const newLine = group.length;
  group.push(beat);
  rebuildEvents(groups);
  markEdited();
  repaintAll('preserve');
  enterEditMode(editingPanel, newLine);
}

/**
 * Put a character in or out of the edited panel.
 *
 * Applies straight to the event rather than waiting for Update, so the panel
 * redraws under your thumb — the same immediacy the arrange controls have. The
 * text field still commits on Update.
 */
function togglePanelMember(id: string): void {
  if (editingPanel < 0 || id === state.speaker) return;
  const i = pending.addressees.indexOf(id);
  if (i >= 0) pending.addressees.splice(i, 1);
  else pending.addressees.push(id);

  const ev = editingEvent();
  if (!ev || ev.type === 'break' || ev.type === 'join' || ev.type === 'leave') return;
  const list = pending.addressees.filter((a) => a !== state.speaker);
  (ev as MessageEvent | ReactionEvent).addressees = list.length ? [...list] : undefined;

  markEdited();
  repaintAll('preserve');
  renderPanelCast();
  renderInScene();
}

function renderInScene(): void {
  const host = $('in-scene');
  const row = $('arrange-row');
  const hide = (): void => { host.innerHTML = ''; row.classList.remove('is-shown'); };
  if (editingPanel < 0) return hide();
  const panel = currentPanels[editingPanel];
  // Arranging is meaningless below two characters — the row stays out of the
  // way until there is actually something to order.
  if (!panel || panel.characters.length < 2) return hide();
  row.classList.add('is-shown');
  const chars = panel.characters.slice().sort((a, b) => a.x - b.x);
  host.innerHTML = chars
    .map((c, i) => {
      const facingArrow = c.facing === 'left' ? '&#9664;' : '&#9654;';
      const canL = i > 0;
      const canR = i < chars.length - 1;
      const name = esc(castName(c.characterId, manifests[c.characterId]?.name));
      return (
        `<div class="isc" data-cid="${c.characterId}" style="--c:${colorOf(c.author)}">` +
        `<button class="isc-nudge" data-nudge="left" ${canL ? '' : 'disabled'} aria-label="Move ${name} left">&#8249;</button>` +
        `<button class="isc-name" data-flip="1" aria-label="Flip ${name}">${name} <span class="isc-face">${facingArrow}</span></button>` +
        `<button class="isc-nudge" data-nudge="right" ${canR ? '' : 'disabled'} aria-label="Move ${name} right">&#8250;</button>` +
        `</div>`
      );
    })
    .join('');
}

/** The current beat's `at` value, or null if not editing. */
function currentBeatAt(): number | null {
  // The panel's placement key — its first beat, matching `applyBeatOverrides`.
  return panelGroups()[editingPanel]?.[0]?.at ?? null;
}

function overridesFor(at: number): BeatOverrides {
  let ov = overrides.get(at);
  if (!ov) { ov = {}; overrides.set(at, ov); }
  return ov;
}

function flipCharacterFacing(charId: string): void {
  const at = currentBeatAt();
  if (at === null) return;
  const panel = currentPanels[editingPanel];
  if (!panel) return;
  const char = panel.characters.find((c) => c.characterId === charId);
  if (!char) return;
  const ov = overridesFor(at);
  ov.facing = { ...(ov.facing ?? {}), [charId]: char.facing === 'left' ? 'right' : 'left' };
  markEdited();
  repaintAll('preserve');
  renderInScene();
}

function nudgeCharacter(charId: string, dir: 'left' | 'right'): void {
  const at = currentBeatAt();
  if (at === null) return;
  const panel = currentPanels[editingPanel];
  if (!panel || panel.characters.length < 2) return;
  const orderIds = panel.characters.slice().sort((a, b) => a.x - b.x).map((c) => c.characterId);
  const i = orderIds.indexOf(charId);
  const j = dir === 'left' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= orderIds.length) return;
  [orderIds[i], orderIds[j]] = [orderIds[j]!, orderIds[i]!];
  const ov = overridesFor(at);
  ov.order = orderIds;
  markEdited();
  repaintAll('preserve');
  renderInScene();
}

/**
 * Populate the edit-bar's speaker <select> with every cast member, with the
 * current speaker preselected. Changing it swaps the beat's author on Update.
 */
function renderEditSpeaker(): void {
  const sel = $('edit-speaker') as HTMLSelectElement;
  // Someone else in this panel already has a balloon — the composer allows only
  // one per character per panel, so picking them would just split the panel.
  const taken = new Set(
    editingGroup()
      .filter((_, i) => i !== editingLine)
      .map((ev) => (ev as MessageEvent | ReactionEvent).author),
  );
  sel.innerHTML = state.cast
    .filter((id) => !taken.has(id) || id === state.speaker)
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
  markEdited();
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
  markEdited();
  repaintAll();
}

// ---- Editing an existing panel --------------------------------------------

/**
 * Load a beat into the compose bar and enter edit mode for that panel.
 *
 * `lineIdx` picks which beat within the panel — panels can hold an exchange, so
 * the panel index alone no longer identifies a line. Out-of-range clamps to the
 * first line, which is what makes `enterEditMode(i)` still mean "edit panel i".
 */
function enterEditMode(panelIdx: number, lineIdx = 0): void {
  const group = panelGroups()[panelIdx];
  if (!group || group.length === 0) return;
  const line = lineIdx >= 0 && lineIdx < group.length ? lineIdx : 0;
  const ev = group[line]!;

  editingPanel = panelIdx;
  editingLine = line;

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

  // The tray is no longer forced open on edit. It had to be, back when the
  // addressee control lived at the bottom of it; now that "in this panel" sits
  // in the edit bar, forcing it open only cost the comic ~250px of height —
  // leaving barely a sliver of the panel you're editing. Leave it as the user
  // set it; the wheel and delivery chips are one tap away on `+`.
  $('edit-bar').classList.add('open');
  $('edit-label').textContent =
    group.length > 1
      ? `Editing panel ${panelIdx + 1}, line ${line + 1}`
      : `Editing panel ${panelIdx + 1}`;
  $('send').classList.add('is-update');
  $('send').setAttribute('aria-label', 'Update');
  renderCast();
  renderTray();
  renderEditSpeaker();
  renderLineChips();
  renderPanelCast();
  renderInScene();
  highlightEditingPanel();
  input.focus();
}

function exitEditMode(): void {
  editingPanel = -1;
  editingLine = 0;
  $('comic').querySelectorAll('.panel.is-editing').forEach((el) => el.classList.remove('is-editing'));
  $('edit-bar').classList.remove('open');
  $('send').classList.remove('is-update');
  $('send').setAttribute('aria-label', 'Send');
  // Clear the edit-bar rows through their renderers (editingPanel is already
  // -1, so each empties itself) rather than leaving stale chips to flash on the
  // next open.
  renderLineChips();
  renderPanelCast();
  renderInScene();
  resetComposer();
  renderTray();
}

function updateLine(): void {
  if (editingPanel < 0) return;
  const groups = panelGroups();
  const target = groups[editingPanel]?.[editingLine];
  if (!target) { exitEditMode(); return; }
  const next = pendingEvent(target.at);
  if (!next) return; // nothing to save; keep edit mode open
  groups[editingPanel]![editingLine] = next;
  rebuildEvents(groups);
  markEdited();
  exitEditMode();
  repaintAll('preserve');
}

/**
 * Delete the selected line. Removing a panel's only line removes the panel —
 * `rebuildEvents` drops empty groups, so that falls out for free.
 */
function deleteLine(): void {
  if (editingPanel < 0) return;
  const groups = panelGroups();
  const group = groups[editingPanel];
  if (!group) { exitEditMode(); return; }
  const removed = group.splice(editingLine, 1)[0];
  // Only drop the placement override when the whole panel goes; the key is the
  // group's first beat, and the panel keeps its arrangement across line edits.
  if (removed && group.length === 0) overrides.delete(removed.at);
  rebuildEvents(groups);
  markEdited();
  exitEditMode();
  repaintAll('preserve');
}

/** A fresh empty message event authored by the current speaker. */
function blankBeat(): ChatEvent {
  return {
    type: 'message',
    author: state.speaker,
    text: '',
    at: nextAt(),
  };
}

/** Clone the whole panel — every line in it — and open the copy for editing. */
function duplicatePanel(): void {
  if (editingPanel < 0) return;
  const groups = panelGroups();
  const src = groups[editingPanel];
  if (!src) return;
  let bump = nextAt();
  const copy: ChatEvent[] = src.map((ev) => ({ ...ev, at: bump++ }) as ChatEvent);
  // Clone the source panel's overrides too, so a duplicate arrives with its
  // facing / order intact — otherwise the copy would silently revert to the
  // composer's defaults, surprising the user. Keyed off each group's first beat.
  const srcOv = overrides.get(src[0]!.at);
  if (srcOv) {
    overrides.set(copy[0]!.at, {
      facing: srcOv.facing ? { ...srcOv.facing } : undefined,
      order: srcOv.order ? [...srcOv.order] : undefined,
    });
  }
  groups.splice(editingPanel + 1, 0, copy);
  rebuildEvents(groups);
  markEdited();
  // Slide the edit focus onto the new panel so the user can tweak it right away.
  const newPanel = editingPanel + 1;
  exitEditMode();
  repaintAll('preserve');
  enterEditMode(newPanel);
}

/**
 * Splice a blank editable beat next to the currently-edited panel.
 * `where` = 'before' → new panel takes the current index; the edited one shifts.
 * `where` = 'after'  → new panel takes the next index.
 */
function insertPanel(where: 'before' | 'after'): void {
  if (editingPanel < 0) return;
  const groups = panelGroups();
  const insertAt = where === 'before' ? editingPanel : editingPanel + 1;
  // A new panel starts as one blank line — its own group.
  groups.splice(insertAt, 0, [blankBeat()]);
  rebuildEvents(groups);
  markEdited();
  exitEditMode();
  repaintAll('preserve');
  enterEditMode(insertAt);
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
  markEdited();
  renderCast();
  renderTray();
  // Picking a character *while editing a panel* means you want them in that
  // panel — otherwise you'd have to hunt for a second control to put them
  // there, which is what made adding a second character so tedious.
  if (editingPanel >= 0 && id !== state.speaker) {
    togglePanelMember(id);
    return;
  }
  // Otherwise no repaint: adding to the cast doesn't change any drawn panel —
  // they appear once they speak, in a new panel.
}

// ---- Surprise -------------------------------------------------------------

function loadSeed(seed: number): void {
  state.seed = seed;
  const s = starter(seed);
  state.cast = s.cast;
  state.events = s.events;
  state.scene = s.scene;
  state.speaker = s.cast[0] ?? '';
  overrides.clear();
  if (editingPanel >= 0) exitEditMode();
  // A freshly-rolled starter is disposable again — the dice stops asking.
  touched = false;
  scheduleSave();
  renderCast();
  renderTray();
  repaintAll();
}

function rollNewComic(): void {
  loadSeed(Math.floor(1 + Math.random() * 99999));
}

/**
 * The dice used to be free — nothing was saved, so nothing could be lost.
 * Now that work persists, rolling over an edited comic destroys it, so ask
 * first. An untouched starter still rolls immediately: cycling the dice is
 * how you browse for one, and a confirm on every tap would be in the way.
 */
function surprise(): void {
  if (!touched) return rollNewComic();
  askConfirm({
    title: 'Reroll this comic?',
    body: 'This replaces the comic you’ve been working on. To keep it, use New comic in your library instead.',
    go: 'Roll anyway',
    onGo: rollNewComic,
  });
}

// ---- Export ---------------------------------------------------------------

const EXPORT_CREDIT = 'onionmadder.com/comic-chat-composer';
const COLUMN_CHOICES = [1, 2, 3, 4] as const;
/** Panels per row on the exported sheet. 2 suits a phone-shot comic. */
let exportColumns = 2;

function renderColumnChips(): void {
  $('exp-columns').innerHTML = COLUMN_CHOICES
    .map((n) => {
      const on = n === exportColumns;
      return (
        `<button class="pickchip${on ? ' is-on' : ''}" data-cols="${n}" ` +
        `role="radio" aria-checked="${on}">${n}</button>`
      );
    })
    .join('');
}

function openExport(): void {
  if (!currentPanels.length) return;
  if (editingPanel >= 0) exitEditMode();
  renderColumnChips();
  $('exp-status').textContent = '';
  $('export-sheet').classList.add('open');
}

function closeExport(): void {
  $('export-sheet').classList.remove('open');
}

/**
 * Embed the bundled Comic Neue face into a standalone SVG.
 *
 * An SVG rasterised through an `<img>` is its own document: it cannot reach
 * this page's stylesheet, so without its own `@font-face` the balloon text
 * renders in a fallback serif that is wider than what the composer measured —
 * and overflows the balloons it was fitted to. Everything else in the SVG is
 * already inlined, so this is the last external dependency to close off.
 */
function embedFont(svg: string): string {
  const style = `<defs><style type="text/css">${__FONT_CSS__}</style></defs>`;
  return svg.replace(/^(<svg[^>]*>)/, (m) => m + style);
}

/** UTF-8-safe base64 — `btoa` alone throws on any non-Latin-1 codepoint. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on big strips
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Rasterise an SVG string to a PNG blob at `scale`×.
 *
 * Goes through a data URI rather than a blob URL: some browsers treat an
 * SVG blob URL as cross-origin and taint the canvas, which makes `toBlob`
 * throw a security error at the very last step.
 */
async function rasterize(svg: string, scale: number): Promise<Blob> {
  const dims = svg.match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
  if (!dims) throw new Error('strip SVG has no width/height');
  const w = Number(dims[1]);
  const h = Number(dims[2]);

  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('could not load the strip image'));
    img.src = `data:image/svg+xml;base64,${toBase64(svg)}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

/** Filename-safe slug of the title, for the saved file. */
function slug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'mcomic';
}

/**
 * Hand the PNG to the OS. Web Share puts it straight into the share sheet
 * (the useful path on a phone); the anchor download is the desktop/browser
 * fallback.
 */
async function deliver(png: Blob, filename: string): Promise<string> {
  const file = new File([png], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'Shared.';
    } catch (err) {
      // A user dismissing the share sheet is not a failure — don't fall
      // through to a surprise download they didn't ask for.
      if (err instanceof DOMException && err.name === 'AbortError') return '';
      // Anything else (unsupported payload, transient failure): save instead.
    }
  }
  const url = URL.createObjectURL(png);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Saved ${filename}`;
}

async function runExport(): Promise<void> {
  const btn = $('exp-go') as HTMLButtonElement;
  const status = $('exp-status');
  if (!currentPanels.length) { status.textContent = 'Nothing to export yet.'; return; }

  const title = ($('exp-title') as HTMLInputElement).value.trim();
  const subtitle = ($('exp-subtitle') as HTMLInputElement).value.trim();
  const credits = ($('exp-credits') as HTMLInputElement).checked;

  btn.disabled = true;
  status.textContent = 'Drawing…';
  try {
    const svg = renderStripSvg(
      currentPanels.map((p) => ({ ...p, camera: FLAT_CAMERA })),
      renderOptions(),
      {
        columns: exportColumns,
        title: title || undefined,
        subtitle: subtitle || undefined,
        // Match the demo: the credit line only rides along on a titled export.
        credit: title || subtitle ? EXPORT_CREDIT : undefined,
        credits,
      },
    );
    const png = await rasterize(embedFont(svg), 2);
    const message = await deliver(png, `${slug(title)}.png`);
    status.textContent = message;
    if (message) setTimeout(closeExport, 1200);
  } catch (err) {
    status.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    btn.disabled = false;
  }
}

// ---- Persistence ----------------------------------------------------------

/**
 * Has the user changed anything since the last dice roll?
 *
 * Guards the roll: an untouched starter is disposable (rolling repeatedly is
 * how you browse for one), but a comic you've worked on is not.
 */
let touched = false;

/** Character ids the bundled art actually has — used to prune a stale save. */
const KNOWN_CHARACTERS = new Set(Object.keys(manifests));

/** Which draft the compose screen is currently editing. */
let currentId = newDraftId();
/** The draft's filing label, and whether the user set it by hand. */
let currentName = '';
let nameIsCustom = false;

let saveTimer: number | null = null;

function snapshot(): SavedComic {
  return {
    v: 1,
    id: currentId,
    // An untouched name tracks the opening line, so drafts stay tellable apart
    // without the user ever having to name one.
    name: nameIsCustom && currentName ? currentName : autoName(state.events),
    nameIsCustom,
    cast: state.cast,
    events: state.events,
    scene: state.scene,
    seed: state.seed,
    speaker: state.speaker,
    overrides: [...overrides.entries()],
    export: {
      title: ($('exp-title') as HTMLInputElement).value,
      subtitle: ($('exp-subtitle') as HTMLInputElement).value,
      columns: exportColumns,
      credits: ($('exp-credits') as HTMLInputElement).checked,
    },
    touched,
    savedAt: Date.now(),
  };
}

/** Persist shortly — coalesces the burst of calls a drag or a keystroke makes. */
function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveDraft(snapshot());
  }, 400);
}

/** Persist right now. For the moments we might not get another chance. */
function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveDraft(snapshot());
}

/** Mark the comic edited and queue a save. Called from every mutator. */
function markEdited(): void {
  touched = true;
  scheduleSave();
}

/** Restore a saved comic into app state and paint it. */
function hydrate(saved: SavedComic): void {
  currentId = saved.id;
  currentName = saved.name;
  nameIsCustom = saved.nameIsCustom;
  setCurrentId(saved.id);
  state.cast = saved.cast;
  state.events = saved.events;
  state.scene = saved.scene;
  state.seed = saved.seed;
  state.speaker = saved.speaker;
  touched = saved.touched;

  overrides.clear();
  for (const [at, ov] of saved.overrides) overrides.set(at, { ...ov });

  if (saved.export) {
    ($('exp-title') as HTMLInputElement).value = saved.export.title ?? '';
    ($('exp-subtitle') as HTMLInputElement).value = saved.export.subtitle ?? '';
    ($('exp-credits') as HTMLInputElement).checked = saved.export.credits ?? false;
    const cols = saved.export.columns;
    if (cols && COLUMN_CHOICES.includes(cols as (typeof COLUMN_CHOICES)[number])) {
      exportColumns = cols;
    }
  }

  renderCast();
  renderTray();
  repaintAll();
}

/**
 * Android kills backgrounded WebViews without warning, and a pending debounce
 * dies with the page. Flush on the way out — this is the save that matters on
 * a real device.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
});
window.addEventListener('pagehide', flushSave);

// ---- Confirm sheet --------------------------------------------------------

let confirmAction: (() => void) | null = null;

/**
 * Ask before something destructive. A sheet rather than `window.confirm`: the
 * native dialog looks alien inside an APK and some WebViews suppress it.
 */
function askConfirm(opts: { title: string; body: string; go: string; onGo: () => void }): void {
  $('confirm-title').textContent = opts.title;
  $('confirm-copy').textContent = opts.body;
  $('confirm-go').textContent = opts.go;
  confirmAction = opts.onGo;
  $('confirm').classList.add('open');
}

function closeConfirm(): void {
  $('confirm').classList.remove('open');
  confirmAction = null;
}

// ---- The draft library ----------------------------------------------------

/** Switch to another draft, saving the current one first. */
function openDraft(id: string): void {
  if (id === currentId) return closeLibrary();
  flushSave();
  const draft = loadDraft(id, KNOWN_CHARACTERS);
  if (!draft) { renderLibrary(); return; } // vanished under us; just refresh
  if (editingPanel >= 0) exitEditMode();
  hydrate(draft);
  closeLibrary();
}

/** Start a fresh comic as its own draft, leaving the current one filed away. */
function newDraft(): void {
  flushSave();
  if (editingPanel >= 0) exitEditMode();
  currentId = newDraftId();
  currentName = '';
  nameIsCustom = false;
  setCurrentId(currentId);
  // A random starter rather than a blank page: an empty comic has no cast, so
  // there'd be nobody to type as. The dice reroll is one tap away from here.
  loadSeed(Math.floor(1 + Math.random() * 99999));
  closeLibrary();
}

function removeDraft(id: string): void {
  deleteDraft(id);
  if (id !== currentId) { renderLibrary(); return; }
  // Deleted the comic we're looking at — fall to the newest survivor, or start
  // fresh if that was the last one.
  const rest = listDrafts(KNOWN_CHARACTERS).filter((d) => d.id !== id);
  if (editingPanel >= 0) exitEditMode();
  const next = rest[0];
  if (next) hydrate(next);
  else {
    currentId = newDraftId();
    currentName = '';
    nameIsCustom = false;
    setCurrentId(currentId);
    loadSeed(7);
  }
  renderLibrary();
}

function duplicateDraft(id: string): void {
  const src = loadDraft(id, KNOWN_CHARACTERS);
  if (!src) return;
  saveDraft({
    ...src,
    id: newDraftId(),
    name: `${src.name} copy`,
    nameIsCustom: true,
    savedAt: Date.now(),
  });
  renderLibrary();
}

function renameDraft(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) { renderLibrary(); return; }
  if (id === currentId) {
    currentName = trimmed;
    nameIsCustom = true;
    flushSave();
  } else {
    const draft = loadDraft(id, KNOWN_CHARACTERS);
    if (draft) saveDraft({ ...draft, name: trimmed, nameIsCustom: true });
  }
  renderLibrary();
}

/** How many panels a stored draft composes to — the library's "3 panels" line. */
function draftPanelCount(d: SavedComic): number {
  return d.events.filter(isContentEvent).length;
}

function relativeTime(ms: number): string {
  if (!ms) return '';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function renderLibrary(): void {
  // The in-memory comic is newer than its stored copy, so show live values for
  // the current draft rather than whatever the last debounce happened to write.
  const drafts = listDrafts(KNOWN_CHARACTERS).map((d) =>
    d.id === currentId ? { ...d, ...snapshot() } : d,
  );
  if (!drafts.some((d) => d.id === currentId)) drafts.unshift(snapshot());
  drafts.sort((a, b) => b.savedAt - a.savedAt);

  $('library-list').innerHTML = drafts
    .map((d) => {
      const active = d.id === currentId ? ' is-current' : '';
      const panels = draftPanelCount(d);
      const when = relativeTime(d.savedAt);
      return `<div class="draft${active}" data-draft="${esc(d.id)}">
        <button class="draft-open" data-act="open" data-draft="${esc(d.id)}">
          <span class="draft-name" data-act="rename" data-draft="${esc(d.id)}">${esc(d.name)}</span>
          <span class="draft-meta">${panels} panel${panels === 1 ? '' : 's'}${when ? ` · ${when}` : ''}${active ? ' · open now' : ''}</span>
        </button>
        <button class="draft-btn" data-act="dupe" data-draft="${esc(d.id)}" aria-label="Duplicate ${esc(d.name)}" title="Duplicate">&#128203;</button>
        <button class="draft-btn del" data-act="del" data-draft="${esc(d.id)}" aria-label="Delete ${esc(d.name)}" title="Delete">&#128465;</button>
      </div>`;
    })
    .join('');
}

function openLibrary(): void {
  flushSave();
  renderLibrary();
  $('library-sheet').classList.add('open');
}

function closeLibrary(): void {
  $('library-sheet').classList.remove('open');
}

/** Swap a draft's name for an input, committing on Enter or blur. */
function beginRename(id: string, nameEl: HTMLElement): void {
  const current = nameEl.textContent ?? '';
  const input = document.createElement('input');
  input.className = 'draft-rename';
  input.value = current;
  input.setAttribute('aria-label', 'Comic name');
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = (save: boolean): void => {
    if (done) return;
    done = true;
    if (save) renameDraft(id, input.value);
    else renderLibrary();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
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
$('kind-chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button.pickchip') as HTMLElement | null;
  const k = btn?.dataset.kind as LineKind | undefined;
  if (!k) return;
  pending.kind = k;
  renderKindChips();
});
$('gesture-chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button.pickchip') as HTMLElement | null;
  const g = btn?.dataset.gesture as Gesture | undefined;
  if (!g) return;
  pending.gesture = g;
  renderGestureChips();
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

// ---- Panel tap-vs-hold gesture (edit on tap, reorder on long-press) --------
//
// A short tap opens the beat for editing (same as the old click handler); a
// hold-then-drag lifts the panel and reorders it. Both flows share one
// pointer stream so scroll and edit never fight each other:
//
//   pointerdown → arm a 350ms hold timer
//   pointermove > 10px before the timer → this was a scroll; cancel the timer
//   timer fires with the finger still down → activate drag (capture, halo, no scroll)
//   pointerup (short + still) → tap → enter/exit edit mode
//   pointerup (during active drag) → compute drop target, movePanel, cleanup

interface PanelGesture {
  panelIdx: number;
  panelEl: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  activated: boolean;
  holdTimer: number | null;
  targetIdx: number;
  panelHeight: number;
  panelGap: number;
}

let gesture: PanelGesture | null = null;
const DRAG_HOLD_MS = 350;
const DRAG_MOVE_THRESHOLD = 10;   // px before the hold timer aborts
const TAP_MAX_MS = 500;

function panelStep(g: PanelGesture): number {
  return g.panelHeight + g.panelGap;
}

/** During drag, shift every non-dragged panel to open a slot at `targetIdx`. */
function reflowSiblings(g: PanelGesture): void {
  const step = panelStep(g);
  const panels = Array.from($('comic').querySelectorAll('figure.panel')) as HTMLElement[];
  panels.forEach((el, i) => {
    if (i === g.panelIdx) return;
    let displayPos = i > g.panelIdx ? i - 1 : i;
    if (displayPos >= g.targetIdx) displayPos += 1;
    const shift = (displayPos - i) * step;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function clearSiblingReflow(): void {
  const panels = Array.from($('comic').querySelectorAll('figure.panel')) as HTMLElement[];
  panels.forEach((el) => { el.style.transform = ''; });
}

function activatePanelDrag(): void {
  if (!gesture || gesture.moved) return;
  gesture.activated = true;
  gesture.holdTimer = null;
  // Visuals first — safe even if pointer capture is unavailable (some
  // synthetic events, some browsers on obscure input paths).
  gesture.panelEl.classList.add('is-dragging');
  $('comic').classList.add('is-drag-active');
  try { gesture.panelEl.setPointerCapture(gesture.pointerId); } catch { /* not fatal */ }
  if ('vibrate' in navigator) navigator.vibrate?.(15);
  reflowSiblings(gesture);
}

function endGesture(): void {
  if (!gesture) return;
  if (gesture.holdTimer !== null) clearTimeout(gesture.holdTimer);
  if (gesture.activated) {
    try { gesture.panelEl.releasePointerCapture(gesture.pointerId); } catch { /* already released */ }
    gesture.panelEl.classList.remove('is-dragging');
    gesture.panelEl.style.transform = '';
    $('comic').classList.remove('is-drag-active');
    clearSiblingReflow();
  }
  gesture = null;
}

function movePanel(from: number, to: number): void {
  if (from === to) return;
  const groups = panelGroups();
  // Moves the whole panel — every line in it travels together.
  const [moved] = groups.splice(from, 1);
  if (moved === undefined) return;
  groups.splice(to, 0, moved);
  rebuildEvents(groups);
  markEdited();
  if (editingPanel >= 0) exitEditMode();
  repaintAll('preserve');
}

$('comic').addEventListener('pointerdown', (e) => {
  const pe = e as PointerEvent;
  if (pe.button !== 0 && pe.pointerType === 'mouse') return;
  const fig = (pe.target as HTMLElement).closest('figure.panel') as HTMLElement | null;
  if (!fig) return;
  if (gesture) endGesture();
  const rect = fig.getBoundingClientRect();
  gesture = {
    panelIdx: Number(fig.dataset.panelIdx),
    panelEl: fig,
    pointerId: pe.pointerId,
    startX: pe.clientX,
    startY: pe.clientY,
    startTime: performance.now(),
    moved: false,
    activated: false,
    holdTimer: window.setTimeout(activatePanelDrag, DRAG_HOLD_MS),
    targetIdx: Number(fig.dataset.panelIdx),
    panelHeight: rect.height,
    panelGap: 14, // matches .comic { gap: 14px } in style.css
  };
});

$('comic').addEventListener('pointermove', (e) => {
  const pe = e as PointerEvent;
  if (!gesture || pe.pointerId !== gesture.pointerId) return;
  const dx = pe.clientX - gesture.startX;
  const dy = pe.clientY - gesture.startY;
  if (!gesture.activated) {
    // Still deciding — a real move means scroll, so abort the hold-to-drag.
    if (Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD) {
      if (gesture.holdTimer !== null) clearTimeout(gesture.holdTimer);
      gesture.holdTimer = null;
      gesture.moved = true;
    }
    return;
  }
  pe.preventDefault();
  gesture.panelEl.style.transform = `translateY(${dy}px)`;
  // Recompute drop target from the finger's current Y.
  const centerY = pe.clientY;
  const panels = Array.from($('comic').querySelectorAll('figure.panel')) as HTMLElement[];
  let count = 0;
  panels.forEach((el, i) => {
    if (i === gesture!.panelIdx) return;
    const r = el.getBoundingClientRect();
    if (r.top + r.height / 2 < centerY) count++;
  });
  if (count !== gesture.targetIdx) {
    gesture.targetIdx = count;
    reflowSiblings(gesture);
  }
});

$('comic').addEventListener('pointerup', (e) => {
  const pe = e as PointerEvent;
  if (!gesture || pe.pointerId !== gesture.pointerId) return;
  const wasActive = gesture.activated;
  const wasMoved = gesture.moved;
  const duration = performance.now() - gesture.startTime;
  const from = gesture.panelIdx;
  const to = gesture.targetIdx;
  endGesture();
  if (wasActive) {
    if (from !== to) movePanel(from, to);
    return;
  }
  // Not a drag — treat as tap if quick and still.
  if (!wasMoved && duration < TAP_MAX_MS) {
    if (editingPanel === from) exitEditMode();
    else enterEditMode(from);
  }
});

$('comic').addEventListener('pointercancel', endGesture);
$('comic').addEventListener('lostpointercapture', endGesture);
$('edit-cancel').addEventListener('click', exitEditMode);
$('edit-delete').addEventListener('click', deleteLine);
$('edit-dup').addEventListener('click', duplicatePanel);
$('edit-ins-before').addEventListener('click', () => insertPanel('before'));
$('edit-ins-after').addEventListener('click', () => insertPanel('after'));
$('panel-cast').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!btn) return;
  if (btn.id === 'panel-cast-add') return openCharPicker();
  const id = btn.dataset.member;
  if (id) togglePanelMember(id);
});

$('line-chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!btn || (btn as HTMLButtonElement).disabled) return;
  if (btn.id === 'line-add') return addLineToPanel();
  const n = Number(btn.dataset.line);
  if (Number.isFinite(n) && n !== editingLine) enterEditMode(editingPanel, n);
});

$('in-scene').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const chip = target.closest('.isc') as HTMLElement | null;
  if (!chip) return;
  const cid = chip.dataset.cid;
  if (!cid) return;
  const nudge = target.closest('.isc-nudge') as HTMLElement | null;
  if (nudge) {
    if (nudge.hasAttribute('disabled')) return;
    nudgeCharacter(cid, nudge.dataset.nudge === 'left' ? 'left' : 'right');
    return;
  }
  if (target.closest('.isc-name')) flipCharacterFacing(cid);
});
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

$('export').addEventListener('click', openExport);
$('export-close').addEventListener('click', closeExport);
$('export-sheet').addEventListener('click', (e) => { if (e.target === $('export-sheet')) closeExport(); });
$('exp-columns').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button.pickchip') as HTMLElement | null;
  const n = Number(btn?.dataset.cols);
  if (!Number.isFinite(n) || n < 1) return;
  exportColumns = n;
  renderColumnChips();
  scheduleSave();
});
$('exp-go').addEventListener('click', () => { void runExport(); });
// Export settings are part of the comic, not of one export run — remember them.
// Not `markEdited`: naming your comic shouldn't make the dice start asking.
for (const id of ['exp-title', 'exp-subtitle']) {
  $(id).addEventListener('input', scheduleSave);
}
$('exp-credits').addEventListener('change', scheduleSave);

$('confirm-cancel').addEventListener('click', closeConfirm);
$('confirm-go').addEventListener('click', () => {
  const act = confirmAction;
  closeConfirm();
  act?.();
});
$('confirm').addEventListener('click', (e) => {
  if (e.target === $('confirm')) closeConfirm();
});

$('library').addEventListener('click', openLibrary);
$('library-close').addEventListener('click', closeLibrary);
$('library-new').addEventListener('click', newDraft);
$('library-sheet').addEventListener('click', (e) => {
  if (e.target === $('library-sheet')) closeLibrary();
});
$('library-list').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el) return;
  const id = el.dataset.draft;
  if (!id) return;
  switch (el.dataset.act) {
    case 'rename':
      // Renaming sits inside the open button, so stop it opening the draft too.
      e.stopPropagation();
      beginRename(id, el);
      break;
    case 'open':
      openDraft(id);
      break;
    case 'dupe':
      duplicateDraft(id);
      break;
    case 'del': {
      const name = loadDraft(id, KNOWN_CHARACTERS)?.name ?? 'this comic';
      askConfirm({
        title: 'Delete this comic?',
        body: `“${name}” will be gone for good. This can’t be undone.`,
        go: 'Delete',
        onGo: () => removeDraft(id),
      });
      break;
    }
  }
});

$('sheet-close').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
$('sheet-body').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn?.dataset.pick) addCharacter(btn.dataset.pick);
});

// First paint: pick up wherever the last session left off — the draft that was
// open, or failing that the most recently saved one. If there's nothing to
// restore (a genuine first run, cleared storage, or saves too damaged to trust)
// a fixed welcome comic, so a first launch is the same every time.
migrateLegacySession(KNOWN_CHARACTERS);
const openId = getCurrentId();
const restored =
  (openId ? loadDraft(openId, KNOWN_CHARACTERS) : null) ?? listDrafts(KNOWN_CHARACTERS)[0] ?? null;
if (restored) hydrate(restored);
else {
  setCurrentId(currentId);
  loadSeed(7);
}
