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

import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** Custom native bridge — see app/android/.../SavePhotoPlugin.java. */
interface SavePhotoPlugin {
  save(options: { base64: string; filename?: string; album?: string }): Promise<{ uri: string }>;
}
const SavePhoto = registerPlugin<SavePhotoPlugin>('SavePhoto');
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
import { createWheel, cropToCoin, type WheelApi } from './wheel.ts';
import {
  autoName,
  deleteDraft,
  getCurrentId,
  getHandle,
  hasSeenIntro,
  listDrafts,
  loadDraft,
  markIntroSeen,
  migrateLegacySession,
  newDraftId,
  saveDraft,
  setCurrentId,
  setHandle,
  type SavedComic,
} from './storage.ts';
import { decodeShare, shareUrl, tokenFromHash, type ShareState } from './share.ts';
import {
  autoSplit,
  loadCoop,
  reconcileSides,
  saveCoop,
  sideOf,
  type CoopConfig,
  type Side,
} from './coop.ts';

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

// The most lines "+ line" will pack into one panel. Not a composer rule — the
// glued beats waive those — but a physical one: the balloon band is 40% of a
// 400px square, and a fifth balloon just makes the layout trial split the
// panel in front of the user.
const MAX_PANEL_LINES = 4;

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

/**
 * Overlay stickers per panel — POW! / BOOM! / SIGH... drawn on top of the
 * composed panel SVG. Keyed by the panel's first-beat `at` (same key overrides
 * use), so a sticker follows its panel across edits and reorderings. Not
 * exposed to the composer at all — pure app-side decoration applied in
 * `renderPanelWithStickers`.
 */
const stickers = new Map<number, string[]>();

/**
 * Page divisions: set of first-beat `at` values that start a new page.
 * Empty set = one big page. Keyed by beat `at` (durable through reorders and
 * edits) rather than by panel index (which changes when you insert or delete).
 * A page-start on the first panel is meaningless and ignored.
 */
const pageStarts = new Set<number>();

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

/** Distinct speakers already talking in a group, in speaking order. */
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
    events: withSamePanel(events),
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
// The `panelHtml` string for each panel currently in the DOM, one per `.panel`
// figure in order — the record of what is actually painted. `paintedHtml[i]`
// is the exact markup of `comic.children[i]`, and `paintedSig[i]` is a cheap
// signature of the panel it was rendered from (its index + geometry).
//
// Together they do two jobs. As a *count* (`paintedHtml.length`) this is how
// many panels are drawn, so a new line only ever appends beyond it — an
// already-drawn panel is never re-rendered (the comic is a transcript, not a
// live-recomposed document). As *content + signature* they let a full repaint
// (an edit) reuse both the rendered markup and the DOM node of every panel
// whose geometry is unchanged, so only the panels that actually differ pay for
// `renderPanelToSvg` (the expensive part — it embeds a sprite/backdrop data
// URI per panel) or a DOM write. See `repaintAll`.
let paintedHtml: string[] = [];
let paintedSig: string[] = [];

/**
 * A cheap key that fully determines a panel's rendered markup: its index (which
 * the markup embeds as `data-panel-idx` and the `clip-<i>` id) plus its
 * geometry. A `Panel` is pure data — numbers, strings, small arrays, and *no*
 * sprite bytes (those are looked up at render time) — so stringifying it is far
 * cheaper than rendering it, which is the whole point. Same signature at the
 * same index ⇒ byte-identical markup ⇒ safe to reuse.
 */
/** Include the panel's sticker list AND page-start state in the signature —
 * either changing must re-render the panel so reconcile writes new markup. */
const panelSig = (
  p: Panel,
  idx: number,
  panelStickers: readonly string[],
  pageStart: boolean,
  page: number,
): string =>
  `${idx}|${JSON.stringify(p)}|${panelStickers.join('|')}|${pageStart ? page : ''}`;

/**
 * Wrap a rendered panel SVG with sticker overlays. Empty list is a no-op.
 *
 * Positioning follows a rotation of slots — top-right, bottom-left, top-left,
 * bottom-right, then centre — with a tilt that alternates direction, so a
 * panel with two stickers doesn't have them stacked at the same angle. Draws
 * inside the SVG's own coordinate system (PANEL_W × PANEL_H), so it scales
 * with the panel and clips correctly at the frame edge.
 */
function overlayStickers(svg: string, panelStickers: readonly string[]): string {
  if (panelStickers.length === 0) return svg;
  const w = PANEL_W, h = PANEL_H;
  const slots: Array<[number, number, number]> = [
    [w - 72, 62, -8],
    [70, h - 60, 6],
    [72, 74, 8],
    [w - 70, h - 60, -6],
    [w / 2, h / 2 - 20, -3],
  ];
  const parts = panelStickers.slice(0, slots.length).map((label, i) => {
    const [x, y, deg] = slots[i]!;
    const text = label.trim().toUpperCase();
    // Stroke width sized to a big display font; two layers (dark stroke,
    // yellow fill) gives the classic Batman-caption feel that reads on any
    // backdrop, dark or light.
    return (
      `<g transform="translate(${x} ${y}) rotate(${deg})" class="sfx-sticker">` +
      `<text x="0" y="0" text-anchor="middle" font-family="'Comic Neue',cursive" ` +
      `font-size="42" font-weight="900" stroke="#08080b" stroke-width="6" ` +
      `stroke-linejoin="round" fill="none">${escXml(text)}</text>` +
      `<text x="0" y="0" text-anchor="middle" font-family="'Comic Neue',cursive" ` +
      `font-size="42" font-weight="900" fill="#ffc61a">${escXml(text)}</text>` +
      `</g>`
    );
  });
  // Insert before the closing </svg>.
  return svg.replace(/<\/svg>\s*$/, parts.join('') + '</svg>');
}

const escXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

/**
 * Derive `samePanel` from the break structure at compose time: every message
 * beat that follows another content beat with no break between them is glued
 * to the open panel (`MessageEvent.samePanel` — the author's word beats the
 * soft panel-break rules; only the layout trial can still split, which
 * `reconcileGroups()` repairs). The app's groups ARE authored panels, so the
 * flag is exactly what the grouping already means. Derived rather than stored
 * so it can never drift from the breaks that define it, and saved drafts are
 * untouched.
 */
function withSamePanel(events: ChatEvent[]): ChatEvent[] {
  let opensPanel = true;
  return events.map((ev) => {
    if (ev.type === 'break') {
      opensPanel = true;
      return ev;
    }
    if (!isContentEvent(ev)) return ev;
    const glued = !opensPanel;
    opensPanel = false;
    return glued && isMessageEvent(ev) ? { ...ev, samePanel: true } : ev;
  });
}

function composeRaw(): Panel[] {
  const castMap: Record<string, CastEntry> = {};
  for (const id of state.cast) castMap[id] = { characterId: id };
  return compose({
    events: withSamePanel(state.events),
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

/** The list of sticker labels on panel `idx`, in order. Empty if none. */
function stickersFor(idx: number): readonly string[] {
  const key = panelGroups()[idx]?.[0]?.at;
  if (key === undefined) return [];
  return stickers.get(key) ?? [];
}

/** True if panel `idx` opens a new page. Never true for panel 0. */
function isPageStart(idx: number): boolean {
  if (idx <= 0) return false;
  const key = panelGroups()[idx]?.[0]?.at;
  return key !== undefined && pageStarts.has(key);
}

/** 1-indexed page number for a panel. Panel 0 → page 1 always. */
function pageOfPanel(idx: number): number {
  const groups = panelGroups();
  let page = 1;
  for (let i = 1; i <= idx && i < groups.length; i++) {
    const at = groups[i]?.[0]?.at;
    if (at !== undefined && pageStarts.has(at)) page++;
  }
  return page;
}

function pageCount(): number {
  return currentPanels.length === 0 ? 0 : pageOfPanel(currentPanels.length - 1);
}

/** Toggle whether the panel *after* `panelIdx` starts a new page. */
function togglePageBreakAfter(panelIdx: number): void {
  const nextGroup = panelGroups()[panelIdx + 1];
  if (!nextGroup) return; // nothing after this panel; no boundary to toggle
  const at = nextGroup[0]?.at;
  if (at === undefined) return;
  if (pageStarts.has(at)) pageStarts.delete(at);
  else pageStarts.add(at);
  markEdited();
  repaintAll('preserve');
  renderPageControls();
}

const panelHtml = (p: Panel, idx: number): string => {
  const svg = renderPanelToSvg({ ...p, camera: FLAT_CAMERA }, renderOptions());
  const withStickers = overlayStickers(svg, stickersFor(idx));
  const pageStart = isPageStart(idx);
  const cls = pageStart ? 'panel is-page-start' : 'panel';
  const pageAttr = pageStart ? ` data-page="${pageOfPanel(idx)}"` : '';
  return `<figure class="${cls}" data-panel-idx="${idx}"${pageAttr}>${withStickers}</figure>`;
};

const scrollToNewest = (): void => {
  const comic = $('comic');
  requestAnimationFrame(() => comic.scrollTo({ top: comic.scrollHeight, behavior: 'smooth' }));
};

/**
 * Recompose and repaint — fresh comic, undo, or an edit.
 *
 * Every panel is recomposed (correctness is not negotiable: an edit can ripple
 * through placement, samePanel gluing, reconciliation), but only the panels
 * whose *markup* actually changed are written to the DOM. Editing one panel of
 * a long comic used to re-render every one of them — 21ms of blocked main
 * thread at 28 panels, and it grew with the comic; now it is the cost of the
 * one panel that changed. See `reconcilePanels`.
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
  if (!panels.length) {
    comic.innerHTML = EMPTY_HTML;
    paintedHtml = [];
    paintedSig = [];
    return;
  }

  // Render only the panels whose signature changed; reuse the exact markup of
  // the rest. Reused panels never call `renderPanelToSvg` — the expensive step
  // — and `reconcilePanels` then skips their DOM write too, because the reused
  // string is `===` the painted one.
  const prevHtml = paintedHtml;
  const prevSig = paintedSig;
  const nextHtml: string[] = new Array(panels.length);
  const nextSig: string[] = new Array(panels.length);
  for (let i = 0; i < panels.length; i++) {
    const sig = panelSig(panels[i]!, i, stickersFor(i), isPageStart(i), pageOfPanel(i));
    nextSig[i] = sig;
    nextHtml[i] = sig === prevSig[i] ? prevHtml[i]! : panelHtml(panels[i]!, i);
  }

  reconcilePanels(comic, nextHtml);
  paintedHtml = nextHtml;
  paintedSig = nextSig;

  if (editingPanel >= 0) highlightEditingPanel();
  if (scroll === 'preserve') comic.scrollTop = savedTop;
  else scrollToNewest();
}

/**
 * Patch the comic's `.panel` figures to match `next`, touching the DOM only
 * where the markup differs from what is painted.
 *
 * Positional diff: `next[i]` against `paintedHtml[i]`. The dominant edit — a
 * panel's text, pose, facing, membership, or arrangement — changes one panel's
 * markup and leaves its neighbours and the panel count untouched, so exactly
 * one `<figure>` is replaced. Verbs that change the count (insert, duplicate,
 * delete) shift `data-panel-idx` on the panels after the edit and so re-render
 * that tail — bounded by the old full-rebuild cost, never worse.
 *
 * When most panels changed (a fresh seed, or an early edit that ripples through
 * the composer's shared perturbation stream), a single `innerHTML` write beats
 * a swarm of per-node `outerHTML` swaps, so fall back to that past a threshold.
 *
 * Replacing a figure's `outerHTML` is safe because the tap/hold listeners are
 * delegated on `#comic`, not bound per panel, and the new node keeps the same
 * position (and gets a correct `data-panel-idx`).
 */
function reconcilePanels(comic: HTMLElement, next: string[]): void {
  const old = paintedHtml;
  // Coming from empty (or the very first paint): nothing to diff, one write.
  if (old.length === 0) {
    comic.innerHTML = next.join('');
    return;
  }
  const shared = Math.min(old.length, next.length);
  const changed: number[] = [];
  for (let i = 0; i < shared; i++) if (next[i] !== old[i]) changed.push(i);

  // Past ~half the panels, one bulk write is cheaper than many node swaps.
  if (changed.length + Math.abs(next.length - old.length) > next.length / 2) {
    comic.innerHTML = next.join('');
    return;
  }

  for (const i of changed) comic.children[i]!.outerHTML = next[i]!;
  if (next.length > old.length) {
    let extra = '';
    for (let i = old.length; i < next.length; i++) extra += next[i];
    comic.insertAdjacentHTML('beforeend', extra);
  } else if (next.length < old.length) {
    for (let i = old.length - 1; i >= next.length; i--) comic.children[i]!.remove();
  }
}

/** Append only the panels a new line produced. Existing panels are untouched. */
function appendPanels(): void {
  const comic = $('comic');
  const panels = composePanels();
  if (paintedHtml.length === 0) comic.innerHTML = ''; // clear the empty-state message
  for (let i = paintedHtml.length; i < panels.length; i++) {
    const html = panelHtml(panels[i]!, i);
    comic.insertAdjacentHTML('beforeend', html);
    paintedHtml.push(html);
    paintedSig.push(panelSig(panels[i]!, i, stickersFor(i), isPageStart(i), pageOfPanel(i)));
  }
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
      // In co-op the off-side stays visible (you can see who your partner
      // voices), but disabled — tapping does nothing, and the chip greys
      // out. The side badge (border colour on one edge) tells you which
      // team without needing to read a legend.
      let sideCls = '';
      let sideDisabled = '';
      if (coop.enabled) {
        const s = sideOf(coop, id);
        sideCls = s ? ` is-side-${s.toLowerCase()}` : '';
        // Turn constraint only bites while composing new beats. Editing is
        // rewriting history, so every chip stays tappable — otherwise you
        // couldn't fix a Side A line while it's Side B's turn.
        if (s !== coopSide && editingPanel < 0) sideDisabled = ' disabled';
      }
      return (
        `<button class="chip${active}${sideCls}" data-id="${id}" style="--c:${colorOf(id)}" ` +
        `aria-pressed="${id === state.speaker}"${sideDisabled}>${esc(castName(id, manifests[id]?.name))}</button>`
      );
    })
    .join('');
  $('cast').innerHTML = chips + `<button class="chip add" id="add-char" aria-label="Add a character">+</button>`;
  const who = state.speaker ? castName(state.speaker, manifests[state.speaker]?.name) : '—';
  $('speaking').textContent = state.cast.length ? `${who} is speaking` : 'Add characters to begin';
  renderMoreButton();
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
 * "In this panel" — one row that does two jobs that used to be two rows.
 *
 * Every cast member appears as a chip:
 *   - **speaker**: the beat's author, shown locked (● Name) as context
 *   - **in frame**: solid chip with the arrange controls inline when 2+ people
 *     are in the frame — `‹ Name ▶ ×` — so reorder / flip / remove all live
 *     on the character they act on, not in a separate row
 *   - **out of frame**: dashed `+ Name` chip, tap to bring them in
 *
 * The single-panel version replaces two rows ("in this panel" + "arrange")
 * that were about the same 2–3 people. Same functions, half the vertical
 * space, no separate mental model of "arrange mode".
 */
function renderPanelCast(): void {
  const host = $('panel-cast');
  if (editingPanel < 0) { host.innerHTML = ''; return; }

  // Who's in frame, and in what order. Prefer the composed panel's
  // characters (that's the ground truth for x-order and facing); fall back
  // to speaker + pending addressees for the moment right after a toggle
  // when a repaint may not have landed yet.
  const panel = currentPanels[editingPanel];
  const inFrameByX = panel
    ? panel.characters.slice().sort((a, b) => a.x - b.x).map((c) => c.characterId)
    : [];
  const facingByCid = new Map(panel?.characters.map((c) => [c.characterId, c.facing]) ?? []);

  const inFrame = new Set<string>(inFrameByX);
  if (state.speaker) inFrame.add(state.speaker);
  for (const id of pending.addressees) inFrame.add(id);

  // Final ordered list of in-frame ids: composed order first, then anyone
  // toggled in that hasn't hit the layout yet, tacked on the end.
  const ordered = [...inFrameByX];
  for (const id of inFrame) if (!ordered.includes(id)) ordered.push(id);

  // Only offer reorder controls when there's actually someone to reorder
  // *against*. Speaker doesn't count — you don't nudge yourself.
  const nonSpeakerCount = ordered.filter((id) => id !== state.speaker).length;
  const arrangeable = nonSpeakerCount >= 1 && ordered.length >= 2;

  const chips: string[] = [];

  ordered.forEach((cid, i) => {
    const name = esc(castName(cid, manifests[cid]?.name));
    const color = colorOf(cid);
    if (cid === state.speaker) {
      // Locked speaker — shown as context, not toggleable. Change via cast strip.
      chips.push(
        `<span class="pcast is-speaker" style="--c:${color}" ` +
        `title="${name} is speaking in this panel">&#9679; ${name}</span>`,
      );
      return;
    }
    if (arrangeable) {
      // Compound chip: reorder + flip + remove, all on the person they act on.
      const facing = facingByCid.get(cid);
      const facingArrow = facing === 'left' ? '&#9664;' : '&#9654;';
      const canL = i > 0;
      const canR = i < ordered.length - 1;
      chips.push(
        `<div class="pcast is-frame" data-cid="${cid}" style="--c:${color}">` +
        `<button class="pcast-nudge" data-nudge="left" data-cid="${cid}" ${canL ? '' : 'disabled'} aria-label="Move ${name} left">&#8249;</button>` +
        `<button class="pcast-name" data-flip="${cid}" aria-label="Flip ${name}">${name} <span class="pcast-face">${facingArrow}</span></button>` +
        `<button class="pcast-nudge" data-nudge="right" data-cid="${cid}" ${canR ? '' : 'disabled'} aria-label="Move ${name} right">&#8250;</button>` +
        `<button class="pcast-remove" data-remove="${cid}" aria-label="Remove ${name} from panel">&times;</button>` +
        `</div>`,
      );
      return;
    }
    // Lone non-speaker: tap-to-remove, no arrange controls (nothing to arrange against).
    chips.push(
      `<button class="pcast is-on" data-remove="${cid}" style="--c:${color}" ` +
      `aria-pressed="true" aria-label="Remove ${name} from panel">&#10003; ${name}</button>`,
    );
  });

  // Everyone else in the cast → "+ Name" chip.
  for (const cid of state.cast) {
    if (inFrame.has(cid)) continue;
    const name = esc(castName(cid, manifests[cid]?.name));
    chips.push(
      `<button class="pcast" data-add="${cid}" style="--c:${colorOf(cid)}" ` +
      `aria-pressed="false" aria-label="Add ${name} to this panel">&#43; ${name}</button>`,
    );
  }

  chips.push(
    `<button class="pcast add" id="panel-cast-add" aria-label="Add a new character to this panel">&#43;&hellip;</button>`,
  );

  host.innerHTML = chips.join('');
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
  // Glued beats waive the composer's one-balloon-per-character rule
  // (`samePanel`), so a character can speak twice in a frame and the old
  // distinct-speaker ceiling is gone. What remains is physical: the balloon
  // band is ~40% of a 400px panel, and past four balloons the layout trial
  // splits the panel anyway — don't offer what will visibly break.
  const canAdd = group.length < MAX_PANEL_LINES && availableVoices(group).length > 0;

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
    : 'This panel is full — four balloons is all a frame can hold';
  host.innerHTML =
    chips +
    `<button class="pcast add" id="line-add" ${canAdd ? '' : 'disabled'} ` +
    `title="${addTitle}" aria-label="${addTitle}">&#43; line</button>`;
  // A single-line panel needs no line picker — keep simple panels simple. It
  // still shows when there is room to add one, since that's the whole point.
  row.classList.toggle('is-shown', group.length > 1 || canAdd);
}

/**
 * Characters who could take a new line in this panel, best default first:
 * in frame without a balloon, then the rest of the cast (while the frame has
 * room under the character cap), then a repeat balloon for someone already
 * speaking — legal now that glued beats waive the one-balloon-per-character
 * rule, and the way a character gets to say two things in one frame.
 */
function availableVoices(group: readonly ChatEvent[]): string[] {
  const speaking = speakersIn(group);
  const inFrame = new Set<string>(speaking);
  for (const ev of group) {
    for (const a of (ev as MessageEvent | ReactionEvent).addressees ?? []) inFrame.add(a);
  }
  const silent = [...inFrame].filter((id) => !speaking.includes(id));
  const cap = RULES.maxCharactersPerPanel ?? 3;
  const rest = inFrame.size < cap ? state.cast.filter((id) => !inFrame.has(id)) : [];
  return [...silent, ...rest, ...speaking];
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
  renderPanelCast();
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
  renderPanelCast();
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

/**
 * A cached head-and-shoulders coin of `characterId`, at whatever `size` the
 * caller wants. Uses the wheel's same `cropToCoin` window so the coin on the
 * "more" button reads as *the same face* the wheel node would show. Cached
 * per character — the preview render is not free, and the coin is drawn on
 * every speaker change.
 */
const coinCache = new Map<string, string>();
function speakerCoinSvg(characterId: string): string {
  const hit = coinCache.get(characterId);
  if (hit !== undefined) return hit;
  const raw = previewSvg(characterId, 'neutral', 'neutral');
  // cropToCoin expects the (cx, cy, r) of a wheel node — for a standalone
  // coin we use a small viewBox and let CSS scale the SVG into the button.
  // The values 12/12/12 make a viewBox of 24×24 (border-radius clips to circle).
  const cropped = cropToCoin(raw, 12, 12, 12);
  // Wrap in an outer SVG with the 24×24 viewBox so `.iconbtn.mood svg` styling
  // sizes it correctly.
  const out = cropped
    ? `<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">${cropped}</svg>`
    : '';
  coinCache.set(characterId, out);
  return out;
}

/**
 * Paint the "more" button as a coin of the current speaker + a `+` badge, so
 * the control announces *whose* mood you're about to set. When there's no
 * speaker (empty cast), fall back to the plain `+` glyph so the button still
 * reads as "add / open more".
 */
function renderMoreButton(): void {
  const btn = $('more') as HTMLButtonElement;
  if (!state.speaker) {
    btn.innerHTML = `<span class="more-plus" aria-hidden="true">+</span>`;
    btn.style.removeProperty('--c');
    return;
  }
  btn.style.setProperty('--c', colorOf(state.speaker));
  btn.innerHTML =
    `<span class="more-coin" aria-hidden="true">${speakerCoinSvg(state.speaker)}</span>` +
    `<span class="more-badge" aria-hidden="true">+</span>`;
}

const isTrayOpen = (): boolean => $('tray').classList.contains('open');

/**
 * Open or close the options tray.
 *
 * One setter rather than a `classList.toggle` at the call site, because the
 * tray is now an overlay (see style.css) and two other things have to agree
 * with it: the `+` button's `aria-expanded`, and hardware Back, which closes
 * the tray before it considers leaving the app.
 */
function setTrayOpen(open: boolean): void {
  $('tray').classList.toggle('open', open);
  $('more').setAttribute('aria-expanded', String(open));
  updatePreview();
}

/** Repaint the preview to the current speaker + pending pose. */
function updatePreview(): void {
  if (!state.speaker || !isTrayOpen()) return;
  // Keep the wheel's pose thumbnails on the active speaker. Cheap when the
  // speaker hasn't changed; deferred to tray-open so the nine thumb renders
  // never happen for a control nobody can see.
  wheel?.setCharacter(state.speaker);
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

  if (coop.enabled) {
    // The first beat of a turn opens a new panel for the current side; every
    // beat after that joins it (no separator break — `withSamePanel` glues
    // them). Pass closes the panel by resetting `coopTurnStarted`.
    if (!coopTurnStarted) {
      const last = state.events[state.events.length - 1];
      if (last && last.type !== 'break') state.events.push({ type: 'break', at: state.events.length });
      coopTurnStarted = true;
    }
    ev.at = state.events.length;
    state.events.push(ev);
    resetComposer();
    advanceSpeakerWithinSide();
    markEdited();
    renderCast();
    renderTray();
    // A joined beat changes an existing panel's contents, so `appendPanels`
    // (which only ever renders past the tail) would miss the change. Full
    // repaint — cheap now that it's incremental (only changed panels re-render).
    repaintAll('newest');
    input.focus();
    return;
  }

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
  } else if (isMessageEvent(ev)) {
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
  renderLineChips();
  renderPanelCast();
  renderStickerRow();
  renderPageControls();
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
  renderStickerRow();
  renderPageControls();
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
  // Cast members first (removable), then the rest of the pool (addable). This
  // makes the sheet a "who's in the scene" surface as well as "who to add".
  const inCast = state.cast.filter((id) => POOL.includes(id));
  const rest = POOL.filter((id) => !state.cast.includes(id));
  const chip = (id: string, mode: 'add' | 'remove'): string => {
    const name = esc(castName(id, manifests[id]?.name));
    const dataAttr = mode === 'add' ? `data-pick="${id}"` : `data-remove="${id}"`;
    const label = mode === 'add' ? name : `${name} &times;`;
    return `<button class="pick pick-${mode}" ${dataAttr}><span class="pick-name">${label}</span></button>`;
  };
  const grid =
    (inCast.length
      ? `<div class="pick-section-label">In the scene &mdash; tap to remove</div>` +
        inCast.map((id) => chip(id, 'remove')).join('')
      : '') +
    (rest.length
      ? `<div class="pick-section-label">Add someone</div>` +
        rest.map((id) => chip(id, 'add')).join('')
      : '');
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

/**
 * Take a character off the stage: strip every event they authored, strip
 * their name from every addressee list, drop them from the cast, reassign
 * the speaker if it was them, and wipe their placement/actor bookkeeping.
 * Destructive on comics where they've spoken, so confirmed via a sheet.
 */
function removeCharacter(id: string): void {
  if (!state.cast.includes(id)) return;

  // How many beats they're in — as the author of a message/action/reaction,
  // OR just as an addressee. Only the first is destructive; the second is a
  // graceful de-mention.
  let authoredBeats = 0;
  for (const ev of state.events) {
    if ((ev.type === 'message' || ev.type === 'action' || ev.type === 'reaction') && ev.author === id) {
      authoredBeats++;
    }
  }

  const doRemove = (): void => {
    // Rewrite groups: drop the character's own beats; strip them from the
    // addressees of everyone else's beats. `rebuildEvents` drops any empty
    // groups so a panel that held only their line vanishes with them.
    const groups = panelGroups().map((group) =>
      group
        .filter((ev) => !((ev.type === 'message' || ev.type === 'action' || ev.type === 'reaction') && ev.author === id))
        .map((ev) => {
          if (ev.type !== 'message' && ev.type !== 'action' && ev.type !== 'reaction') return ev;
          const addressees = (ev as MessageEvent | ReactionEvent).addressees?.filter((a) => a !== id);
          return addressees && addressees.length !== ((ev as MessageEvent | ReactionEvent).addressees?.length ?? 0)
            ? { ...ev, addressees: addressees.length ? addressees : undefined }
            : ev;
        }),
    );
    rebuildEvents(groups);

    state.cast = state.cast.filter((c) => c !== id);
    if (state.speaker === id) state.speaker = state.cast[0] ?? '';

    // Actor names and per-beat overrides referencing them are dead weight now.
    delete actors[id];
    // (overrides key off event.at, not character id; entries whose panels
    // vanished are orphaned but harmless — they just don't apply to anything.)

    // Reconcile coop sides against the new cast so a removed character
    // doesn't sit on a side that no longer contains them.
    if (coop.enabled) {
      coop = reconcileSides(coop, state.cast);
      saveCoop(coop);
      if (coop.sideA.length === 0 || coop.sideB.length === 0) {
        // A side went empty — coop can't run with one side. Turn it off
        // rather than pretend to keep it going.
        coop = { ...coop, enabled: false };
        saveCoop(coop);
      }
      coopSide = 'A';
      coopTurnStarted = false;
    }

    closeSheet();
    if (editingPanel >= 0) exitEditMode();
    markEdited();
    renderCast();
    renderTray();
    updateCoopVisibility();
    renderCoopBar();
    repaintAll('preserve');
  };

  const name = castName(id, manifests[id]?.name);
  if (authoredBeats === 0) {
    // Nothing to lose — remove without a nag.
    doRemove();
    return;
  }
  askConfirm({
    title: `Remove ${name}?`,
    body: `${name} has ${authoredBeats} line${authoredBeats === 1 ? '' : 's'} in this comic. Removing them deletes those lines. This can’t be undone.`,
    go: 'Remove',
    onGo: doRemove,
  });
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
  stickers.clear();
  pageStarts.clear();
  // Actor names are per-comic — a fresh starter with a new cast starts blank.
  for (const key of Object.keys(actors)) delete actors[key];
  if (editingPanel >= 0) exitEditMode();
  // A freshly-rolled starter is disposable again — the dice stops asking.
  touched = false;
  scheduleSave();
  // A new cast means the current side assignments no longer describe the
  // stage — reconcile so the coop bar and speaker gating reflect who's here.
  if (coop.enabled) {
    coop = reconcileSides(coop, state.cast);
    saveCoop(coop);
    coopSide = 'A';
    coopTurnStarted = false;
    const first = coopCurrentSideChars()[0];
    if (first) state.speaker = first;
  }
  renderCast();
  renderTray();
  updateCoopVisibility();
  renderCoopBar();
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
  if (editingPanel >= 0) exitEditMode();
  renderColumnChips();
  renderActorInputs();
  updateActorSectionVisibility();
  // An empty comic used to make this a dead tap — the button did nothing at all,
  // which reads as a broken app rather than as "there's nothing here yet". Open
  // the sheet either way and say so.
  const empty = currentPanels.length === 0;
  $('exp-status').textContent = empty ? 'Nothing to export yet — write a line first.' : '';
  ($('exp-go') as HTMLButtonElement).disabled = empty;
  $('export-sheet').classList.add('open');
}

/**
 * One text field per cast member for the "starring" credits — only shown when
 * the credits toggle is on. Leave blank for characters that shouldn't have an
 * actor attributed. Changes commit on input and are persisted per-draft.
 */
function renderActorInputs(): void {
  const list = $('exp-cast-list');
  list.innerHTML = state.cast
    .map((id) => {
      const character = esc(castName(id, manifests[id]?.name));
      const value = esc(actors[id] ?? '');
      return (
        `<label class="exp-cast-row" style="--c:${colorOf(id)}">` +
        `<span class="exp-cast-name">${character}</span>` +
        `<input class="exp-cast-input" type="text" data-cid="${id}" value="${value}"` +
        ` placeholder="actor's name" maxlength="40" autocomplete="off" aria-label="Actor for ${character}">` +
        `</label>`
      );
    })
    .join('');
}

function updateActorSectionVisibility(): void {
  const on = ($('exp-credits') as HTMLInputElement).checked;
  $('exp-cast').hidden = !on;
}

function closeExport(): void {
  $('export-sheet').classList.remove('open');
}

// ---- The walkthrough ------------------------------------------------------

/**
 * Almost every verb in this app is invisible: tapping a panel edits it, holding
 * one moves it, the wheel is a press-drag, and "+ line" is the only way to get a
 * second balloon into a frame. None of that announces itself, so say it once on
 * the first launch — and leave it behind the `?` for when it's forgotten.
 *
 * A sheet rather than coach marks pinned to elements: those need live positions,
 * break when the layout reflows or the comic scrolls, and can't be revisited.
 */
function openIntro(): void {
  if (editingPanel >= 0) exitEditMode();
  $('intro').classList.add('open');
}

function closeIntro(): void {
  const wasFirstLaunch = !hasSeenIntro();
  $('intro').classList.remove('open');
  markIntroSeen();
  // On the very first launch, open the tray once so the mood wheel is
  // revealed in place. Otherwise "+ opens the wheel" is just a line of
  // walkthrough copy, and the wheel stays invisible until someone thinks to
  // press an unlabeled plus icon — which the user demonstrated they wouldn't.
  if (wasFirstLaunch && !isTrayOpen()) setTrayOpen(true);
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

/** Blob → raw base64 (no data URI prefix) — payload the native plugin wants. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Hand the PNG to the OS.
 *
 * Order matters: on Android we go through the native SavePhoto plugin so the
 * file lands in Pictures/mComic96/ via MediaStore and actually appears in
 * Gallery / Google Photos. Users reported that Web Share alone silently ate
 * files — the share sheet is a picker, not a save, and picking the wrong
 * target loses the file. The Web Share and anchor-download branches remain as
 * fallbacks for desktop browsers, iOS, and older Android.
 */
async function deliver(png: Blob, filename: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await blobToBase64(png);
      await SavePhoto.save({ base64, filename, album: 'mComic96' });
      return 'Saved to Gallery ✓';
    } catch {
      // Native path failed (pre-Android-10, permission denied, storage
      // pressure). Fall through to the web-tier flow so the user still has
      // *some* way to keep the file.
    }
  }
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

/**
 * User-typed actor names, keyed by character id. Only characters the user
 * bothered to name appear here — an unset one credits under the character's
 * mComic display name alone (see strip.ts).
 */
const actors: Record<string, string> = {};

/**
 * Build the casting map strip.ts wants: every cast member gets their mComic
 * display name as `character`, and their actor name (if any) as `actor`.
 * That's what stops the credits reading "starring Susan as Susan" — the
 * character label is now Poppy, and the actor slot only shows up when the
 * user has attributed the role to someone.
 */
/** The `at` key that stickers should attach to for the panel being edited. */
function editingStickerKey(): number | null {
  return panelGroups()[editingPanel]?.[0]?.at ?? null;
}

/** Add a sticker label to the panel being edited. */
function addSticker(label: string): void {
  const key = editingStickerKey();
  if (key === null) return;
  const clean = label.trim().slice(0, 20);
  if (!clean) return;
  const list = stickers.get(key) ?? [];
  // Cap at 5 — matches the slot count in overlayStickers; anything past that
  // wouldn't render anywhere anyway.
  if (list.length >= 5) return;
  stickers.set(key, [...list, clean]);
  markEdited();
  renderPanelCast();
  renderStickerRow();
  repaintAll('preserve');
}

function removeStickerAt(index: number): void {
  const key = editingStickerKey();
  if (key === null) return;
  const list = stickers.get(key);
  if (!list) return;
  const next = list.filter((_, i) => i !== index);
  if (next.length) stickers.set(key, next);
  else stickers.delete(key);
  markEdited();
  renderStickerRow();
  repaintAll('preserve');
}

const STICKER_PRESETS = [
  'POW!', 'BOOM!', 'ZAP!', 'WHAM!', 'BONK!', 'CRASH!', 'SMASH!',
  'GASP!', 'SIGH…', 'GRR', 'ARGH!', 'YIKES', 'HUH?', 'OOF',
  'HA HA!', 'HMM…', 'PSST', '…', '!!!', '???',
];

function renderStickerRow(): void {
  const host = $('sticker-chips');
  const row = $('sticker-row');
  if (editingPanel < 0) { host.innerHTML = ''; row.classList.remove('is-shown'); return; }
  const list = stickers.get(editingStickerKey() ?? -1) ?? [];
  const chips = list
    .map(
      (label, i) =>
        `<button class="pcast sfx-chip" data-remove-sticker="${i}" aria-label="Remove ${esc(label)}">` +
        `${esc(label)} &times;</button>`,
    )
    .join('');
  const addBtn = list.length < 5
    ? `<button class="pcast add" id="sticker-add" aria-label="Add a sound effect">&#43; sfx</button>`
    : `<button class="pcast add" disabled title="A panel holds at most 5 stickers">full</button>`;
  host.innerHTML = chips + addBtn;
  row.classList.add('is-shown');
}

/**
 * Render the "page" row for the panel being edited. Shows what page this
 * panel is on, plus a toggle: "Start new page after" iff there's a panel
 * *after* this one to divide from. On the last panel there's no boundary
 * to toggle, so the row shows just the page number.
 */
function renderPageControls(): void {
  const host = $('page-controls');
  const row = $('page-row');
  if (editingPanel < 0) {
    host.innerHTML = '';
    row.classList.remove('is-shown');
    return;
  }
  const totalPages = pageCount();
  const thisPage = pageOfPanel(editingPanel);
  const hasNext = editingPanel < currentPanels.length - 1;
  const pageLabel =
    totalPages <= 1
      ? `<span class="page-badge">Page 1</span>`
      : `<span class="page-badge">Page ${thisPage} of ${totalPages}</span>`;
  const breakIsOn = hasNext && isPageStart(editingPanel + 1);
  const toggle = hasNext
    ? `<button class="page-toggle${breakIsOn ? ' is-on' : ''}" id="page-break-toggle" ` +
      `aria-pressed="${breakIsOn}" ` +
      `title="${breakIsOn ? 'Merge with previous page' : 'End the page here'}">` +
      `${breakIsOn ? '&#10003; End page here' : '&#10142; End page here'}</button>`
    : '';
  host.innerHTML = pageLabel + toggle;
  row.classList.add('is-shown');
}

function openStickerPicker(): void {
  const key = editingStickerKey();
  if (key === null) return;
  const presets = STICKER_PRESETS.map(
    (s) => `<button class="sfx-pick" data-sticker="${esc(s)}">${esc(s)}</button>`,
  ).join('');
  $('sfx-body').innerHTML =
    `<div class="sfx-presets">${presets}</div>` +
    `<label class="sfx-custom-row">` +
    `<span class="lbl">Custom</span>` +
    `<div class="sfx-custom">` +
    `<input id="sfx-custom-input" type="text" maxlength="20" autocomplete="off" placeholder="ZOINKS!" aria-label="Custom sticker text">` +
    `<button id="sfx-custom-add" class="sfx-custom-add">Add</button>` +
    `</div></label>`;
  $('sfx-sheet').classList.add('open');
}

function closeStickerPicker(): void {
  $('sfx-sheet').classList.remove('open');
}

function currentCasting(): Record<string, { character?: string; actor?: string }> {
  const map: Record<string, { character?: string; actor?: string }> = {};
  for (const id of state.cast) {
    const character = castName(id, manifests[id]?.name);
    const actor = actors[id]?.trim();
    map[id] = actor ? { character, actor } : { character };
  }
  return map;
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
        casting: credits ? currentCasting() : undefined,
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

// ---- Share links ----------------------------------------------------------

/** The current comic packed for the wire. Title/subtitle ride along. */
function currentShareState(): ShareState {
  const by = getHandle();
  return {
    v: 1,
    events: state.events,
    cast: state.cast,
    scene: state.scene,
    seed: state.seed,
    speaker: state.speaker,
    overrides: [...overrides.entries()],
    t: ($('exp-title') as HTMLInputElement).value.trim() || undefined,
    st: ($('exp-subtitle') as HTMLInputElement).value.trim() || undefined,
    by: by || undefined,
  };
}

/**
 * Copy a share URL for the current comic to the clipboard.
 *
 * Web Share is tempting — it would drop the link straight into Android's
 * share sheet — but a bare URL through `navigator.share({ text })` gets
 * inconsistent treatment across chat apps (some inline the text, some don't),
 * while a clipboard copy always works. Same button-flash pattern the web
 * demo uses so success is unambiguous.
 */
async function copyShareLink(): Promise<void> {
  const btn = $('exp-share') as HTMLButtonElement;
  const status = $('exp-status');
  const flash = (msg: string): void => {
    status.textContent = msg;
    // Don't overwrite a subsequent Download's status.
    const own = msg;
    setTimeout(() => { if (status.textContent === own) status.textContent = ''; }, 2000);
  };
  if (!currentPanels.length) { flash('Nothing to share yet.'); return; }
  const link = shareUrl(currentShareState());
  try {
    await navigator.clipboard.writeText(link);
    flash('Link copied ✓');
  } catch {
    // WebViews without the async clipboard API — fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); flash('Link copied ✓'); }
    catch { flash('Could not copy — try again'); }
    ta.remove();
  }
  // Keep the button lit briefly so the tap registers even when the status text is off-screen.
  btn.classList.add('is-flash');
  setTimeout(() => btn.classList.remove('is-flash'), 500);
}

/**
 * Open the system share sheet with the current comic's URL — the path for
 * "put this in a group chat / social post". Android renders the picker with
 * every messaging app installed, so the link lands *inside* the target app
 * instead of on the clipboard. Copy link stays around as the fallback for
 * platforms where Web Share isn't available.
 *
 * We share the URL, not the file — a comic link is small, opens in the
 * recipient's app (or the web mirror), and doesn't spend the megabytes a
 * PNG would. The download button remains for "give me the image".
 */
async function shareViaSystem(): Promise<void> {
  const status = $('exp-status');
  const flash = (msg: string): void => {
    status.textContent = msg;
    const own = msg;
    setTimeout(() => { if (status.textContent === own) status.textContent = ''; }, 2000);
  };
  if (!currentPanels.length) { flash('Nothing to share yet.'); return; }
  const state = currentShareState();
  const url = shareUrl(state);
  const title = state.t || 'A comic from mComic \'96';
  const by = state.by ? `${state.by} sent you a comic` : 'Someone sent you a comic';
  if (typeof navigator.share !== 'function') {
    // No Web Share (older browsers, desktop) — fall back to clipboard.
    await copyShareLink();
    return;
  }
  try {
    await navigator.share({ title, text: by, url });
    flash('Shared.');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    // Any other error: fall back to clipboard so the user still has the link.
    await copyShareLink();
  }
}

/**
 * Hydrate the app from a decoded share as a brand-new draft, so a link never
 * silently replaces the comic the user was working on. If the current draft
 * is a fresh untouched starter, it stays in the library — deleting it would
 * be too clever; the user can prune from the library sheet.
 */
function openSharedState(shared: ShareState): void {
  flushSave();
  if (editingPanel >= 0) exitEditMode();

  currentId = newDraftId();
  currentName = '';
  nameIsCustom = false;
  setCurrentId(currentId);

  state.cast = [...shared.cast];
  state.events = [...shared.events];
  state.scene = shared.scene;
  state.seed = shared.seed;
  state.speaker = shared.speaker;
  touched = true; // an imported comic is not a rerollable starter

  overrides.clear();
  for (const [at, ov] of shared.overrides) overrides.set(at, { ...ov });

  // Shared comics don't carry actor names, stickers, or page divisions (none
  // of them are in the share format today) — start blank so the recipient
  // can add their own.
  for (const key of Object.keys(actors)) delete actors[key];
  stickers.clear();
  pageStarts.clear();

  ($('exp-title') as HTMLInputElement).value = shared.t ?? '';
  ($('exp-subtitle') as HTMLInputElement).value = shared.st ?? '';

  if (coop.enabled) {
    coop = reconcileSides(coop, state.cast);
    saveCoop(coop);
    coopSide = 'A';
    coopTurnStarted = false;
  }
  renderCast();
  renderTray();
  updateCoopVisibility();
  renderCoopBar();
  repaintAll();
  flushSave();

  // Attribution — a brief toast so the recipient knows who sent it. Skipped
  // when the sender didn't set a handle (share is anonymous).
  if (shared.by) showToast(`Shared by ${shared.by}`);
}

/** Ephemeral status message pinned above the composer for ~3s. */
function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast!.classList.remove('show'), 3200);
}

/**
 * If the URL fragment carries a share token, decode and open it. Returns
 * whether it did — so the boot path can skip the normal restore. Consumes
 * the hash on success (a refresh must not reimport, since the imported
 * copy is now itself a persisted draft).
 */
function consumeShareFromHash(): boolean {
  const token = tokenFromHash(location.hash);
  if (!token) return false;
  const shared = decodeShare(token, KNOWN_CHARACTERS);
  history.replaceState(null, '', location.pathname + location.search);
  if (!shared) return false;
  openSharedState(shared);
  return true;
}

// ---- Co-op mode -----------------------------------------------------------

// The mechanic test for multiplayer: split the cast into two sides, each
// panel is committed to one side at a time (only that side's characters can
// speak in it), a Pass button hands the next panel to the other side. See
// `app/coop.ts` for the state model. Purely local — one user role-plays both
// sides to feel whether panel-by-panel + one-side-per-turn reads as creation
// or as slow chat with rules.

let coop: CoopConfig = loadCoop();
/** Whose turn — reset to A each launch; in-memory only. */
let coopSide: Side = 'A';
/**
 * Has the current turn added at least one beat yet? Controls whether the
 * next send opens a new panel (start of turn — insert a break separator) or
 * joins the current one (subsequent beats — no break, `withSamePanel` glues
 * them). Reset on Pass and on every launch.
 */
let coopTurnStarted = false;

/** Character ids for the side that's currently up. */
function coopCurrentSideChars(): string[] {
  return coopSide === 'A' ? coop.sideA : coop.sideB;
}

/** Rotate the speaker among the current side's characters — the reply feel. */
function advanceSpeakerWithinSide(): void {
  const side = coopCurrentSideChars();
  if (side.length < 2) return;
  const i = side.indexOf(state.speaker);
  state.speaker = side[(i + 1) % side.length]!;
}

/** Show/hide the coop bar and reflect the enabled state on the toggle. */
function updateCoopVisibility(): void {
  const bar = $('coop-bar');
  const toggle = $('coop-toggle') as HTMLButtonElement;
  const label = toggle.querySelector('.coop-toggle-label') as HTMLElement | null;
  toggle.setAttribute('aria-pressed', String(coop.enabled));
  if (label) label.textContent = coop.enabled ? 'Co-op mode on' : 'Try co-op mode';
  bar.hidden = !coop.enabled;
  document.body.classList.toggle('coop-side-b', coop.enabled && coopSide === 'B');
}

/** Refresh the turn indicator's side label + coloured dots for that side's cast. */
function renderCoopBar(): void {
  if (!coop.enabled) return;
  $('coop-side-name').textContent = coopSide === 'A' ? 'Side A' : 'Side B';
  const chars = coopCurrentSideChars();
  $('coop-side-cast').innerHTML = chars
    .map(
      (id) =>
        `<span class="coop-dot" style="--c:${colorOf(id)}" title="${esc(castName(id, manifests[id]?.name))}"></span>`,
    )
    .join('');
  document.body.classList.toggle('coop-side-b', coopSide === 'B');
}

/**
 * Enable co-op on the current draft. If sides have never been set (or the
 * cast has changed underneath them), split the current cast in half — first
 * half A, second half B — so the user can just start playing. They can
 * re-split via the swap button.
 */
function enableCoop(): void {
  if (state.cast.length < 2) {
    // A single-character comic has nobody to be "the other side" — the test
    // needs at least one voice per team. Say so and back off.
    alert('Add at least 2 characters before enabling co-op mode.');
    return;
  }
  if (coop.sideA.length === 0 && coop.sideB.length === 0) {
    coop = { enabled: true, ...autoSplit(state.cast) };
  } else {
    coop = reconcileSides({ ...coop, enabled: true }, state.cast);
  }
  saveCoop(coop);
  coopSide = 'A';
  coopTurnStarted = false;
  const first = coopCurrentSideChars()[0];
  if (first) state.speaker = first;
  updateCoopVisibility();
  renderCoopBar();
  renderCast();
  renderTray();
}

function disableCoop(): void {
  coop = { ...coop, enabled: false };
  saveCoop(coop);
  coopTurnStarted = false;
  updateCoopVisibility();
  renderCast();
}

/** Re-split sides from the current cast, keeping co-op enabled. */
function reshuffleSides(): void {
  if (!coop.enabled) return;
  coop = { enabled: true, ...autoSplit(state.cast) };
  saveCoop(coop);
  coopSide = 'A';
  coopTurnStarted = false;
  const first = coopCurrentSideChars()[0];
  if (first) state.speaker = first;
  renderCoopBar();
  renderCast();
  renderTray();
}

/** Pass the turn to the other side; next send opens a new panel for them. */
function coopPass(): void {
  if (!coop.enabled) return;
  coopSide = coopSide === 'A' ? 'B' : 'A';
  coopTurnStarted = false;
  const first = coopCurrentSideChars()[0];
  if (first) state.speaker = first;
  updateCoopVisibility();
  renderCoopBar();
  renderCast();
  renderTray();
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
    actors: Object.keys(actors).length ? { ...actors } : undefined,
    stickers: stickers.size
      ? Object.fromEntries([...stickers.entries()].map(([at, list]) => [String(at), [...list]]))
      : undefined,
    pageStarts: pageStarts.size ? [...pageStarts] : undefined,
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

  // Actor names are per-character, per-comic — swapping drafts must swap
  // whose actor names you see. Wipe and refill from the saved draft.
  for (const key of Object.keys(actors)) delete actors[key];
  if (saved.actors) Object.assign(actors, saved.actors);

  // Stickers likewise: per-panel, per-comic. Serialised as stringified `at`
  // keys (JSON has no numeric keys) so parse them back to numbers here.
  stickers.clear();
  if (saved.stickers) {
    for (const [key, list] of Object.entries(saved.stickers)) {
      const at = Number(key);
      if (Number.isFinite(at) && Array.isArray(list) && list.length) stickers.set(at, [...list]);
    }
  }

  pageStarts.clear();
  if (saved.pageStarts) for (const at of saved.pageStarts) pageStarts.add(at);

  // The restored draft may have a different cast than the last one — a
  // character on a side might no longer exist here, or the cast may have
  // grown. Reconcile so the sides always match what's on stage before we
  // start painting the coop bar or the cast chips.
  if (coop.enabled) {
    coop = reconcileSides(coop, state.cast);
    saveCoop(coop);
    coopSide = 'A';
    coopTurnStarted = false;
  }

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
  updateCoopVisibility();
  renderCoopBar();
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
  // Sync the handle input with whatever's persisted — reflect any changes
  // made in another tab / session before we let the user edit it.
  ($('handle-input') as HTMLInputElement).value = getHandle();
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

wheel = createWheel(
  $('wheel'),
  (v) => {
    pending.expression = v.emotion;
    pending.intensity = v.intensity;
    updatePreview();
  },
  {
    // Each wheel node renders the speaker striking that emotion. Gesture is
    // pinned to neutral so the emotion's own stance shows — a gesture would
    // win the body otherwise (bodyForPose is gesture-first).
    thumbSvg: (id, emotion) => previewSvg(id, emotion, 'neutral'),
  },
);

$('more').addEventListener('click', () => {
  setTrayOpen(!isTrayOpen());
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
// Unified panel-cast handler: every action a chip can trigger dispatches on
// its data-attribute — add / remove / nudge / flip — so the merged row that
// replaced "in this panel" + "arrange" needs only one listener.
$('panel-cast').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  if (btn.id === 'panel-cast-add') return openCharPicker();
  if (btn.dataset.add) return togglePanelMember(btn.dataset.add);
  if (btn.dataset.remove) return togglePanelMember(btn.dataset.remove);
  if (btn.dataset.flip) return flipCharacterFacing(btn.dataset.flip);
  if (btn.dataset.nudge && btn.dataset.cid) {
    return nudgeCharacter(btn.dataset.cid, btn.dataset.nudge === 'left' ? 'left' : 'right');
  }
});

$('line-chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!btn || (btn as HTMLButtonElement).disabled) return;
  if (btn.id === 'line-add') return addLineToPanel();
  const n = Number(btn.dataset.line);
  if (Number.isFinite(n) && n !== editingLine) enterEditMode(editingPanel, n);
});

$('sticker-chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  if (btn.id === 'sticker-add') return openStickerPicker();
  const rem = btn.dataset.removeSticker;
  if (rem !== undefined) removeStickerAt(Number(rem));
});

$('page-controls').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button#page-break-toggle');
  if (!btn) return;
  togglePageBreakAfter(editingPanel);
});

$('sfx-close').addEventListener('click', closeStickerPicker);
$('sfx-sheet').addEventListener('click', (e) => { if (e.target === $('sfx-sheet')) closeStickerPicker(); });
$('sfx-body').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const preset = target.closest('button.sfx-pick') as HTMLElement | null;
  if (preset?.dataset.sticker) {
    addSticker(preset.dataset.sticker);
    closeStickerPicker();
    return;
  }
  if (target.id === 'sfx-custom-add') {
    const input = $('sfx-custom-input') as HTMLInputElement;
    if (input?.value.trim()) {
      addSticker(input.value);
      closeStickerPicker();
    }
  }
});

$('help').addEventListener('click', openIntro);
$('intro-go').addEventListener('click', closeIntro);
$('intro').addEventListener('click', (e) => { if (e.target === $('intro')) closeIntro(); });

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
$('exp-share').addEventListener('click', () => { void copyShareLink(); });
$('exp-share-send').addEventListener('click', () => { void shareViaSystem(); });

$('coop-toggle').addEventListener('click', () => {
  if (coop.enabled) disableCoop();
  else enableCoop();
});
$('coop-pass').addEventListener('click', coopPass);
$('coop-swap').addEventListener('click', reshuffleSides);
// Export settings are part of the comic, not of one export run — remember them.
// Not `markEdited`: naming your comic shouldn't make the dice start asking.
for (const id of ['exp-title', 'exp-subtitle']) {
  $(id).addEventListener('input', scheduleSave);
}
$('exp-credits').addEventListener('change', () => {
  updateActorSectionVisibility();
  scheduleSave();
});

// Actor names — commit on input, so what you see in the credits panel matches
// what you last typed. Not `markEdited`: naming actors doesn't make the dice
// start asking, just as naming the comic doesn't.
$('exp-cast-list').addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.tagName !== 'INPUT') return;
  const cid = input.dataset.cid;
  if (!cid) return;
  const value = input.value.trim();
  if (value) actors[cid] = value;
  else delete actors[cid];
  scheduleSave();
});

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
$('handle-input').addEventListener('input', (e) => {
  setHandle((e.target as HTMLInputElement).value);
});
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
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  if (btn.dataset.pick) return addCharacter(btn.dataset.pick);
  if (btn.dataset.remove) return removeCharacter(btn.dataset.remove);
});

// ---- The soft keyboard ----------------------------------------------------

/**
 * Track whether the soft keyboard is up, as a `kb-up` class on `<body>`.
 *
 * Inferred from the viewport shrinking rather than from the text field having
 * focus, because focus is a lie on a desktop browser — the demo and the dev
 * loop both run there, and collapsing the edit bar on click would be nonsense.
 * A viewport that loses a fifth of its height has a keyboard in it.
 *
 * The baseline is the tallest viewport seen rather than the one at load: the
 * app can start with the keyboard already up (restoring a draft mid-edit), and
 * anchoring to that would leave `kb-up` stuck off for the whole session.
 * Orientation is locked to portrait, so the baseline never legitimately shrinks.
 */
const KEYBOARD_SHRINK = 0.8;
let viewportBaseline = window.visualViewport?.height ?? window.innerHeight;

function syncKeyboardState(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  if (height > viewportBaseline) viewportBaseline = height;
  document.body.classList.toggle('kb-up', height < viewportBaseline * KEYBOARD_SHRINK);
}

window.visualViewport?.addEventListener('resize', syncKeyboardState);
window.addEventListener('resize', syncKeyboardState);
syncKeyboardState();

// ---- Android hardware Back ------------------------------------------------

/**
 * Back has to unwind the UI one layer at a time.
 *
 * Capacitor's default is to hand Back to the WebView, and this is a single-page
 * app with no history entries — so the default was to *quit*. Pressing Back with
 * the export sheet open closed the whole app, which reads as a crash even though
 * autosave means nothing is lost.
 *
 * Order matters and mirrors what's visually on top: sheets (z-index 10) before
 * the tray (5), the tray before the edit bar underneath it. Confirm is checked
 * first because it can open *over* another sheet — deleting a draft from the
 * library — and Back should cancel the question, not the library behind it.
 */
const BACK_LAYERS: { open: () => boolean; close: () => void }[] = [
  { open: () => $('confirm').classList.contains('open'), close: closeConfirm },
  { open: () => $('sfx-sheet').classList.contains('open'), close: closeStickerPicker },
  { open: () => $('export-sheet').classList.contains('open'), close: closeExport },
  { open: () => $('library-sheet').classList.contains('open'), close: closeLibrary },
  { open: () => $('sheet').classList.contains('open'), close: closeSheet },
  { open: () => $('intro').classList.contains('open'), close: closeIntro },
  { open: isTrayOpen, close: () => setTrayOpen(false) },
  { open: () => editingPanel >= 0, close: exitEditMode },
];

CapacitorApp.addListener('backButton', () => {
  const layer = BACK_LAYERS.find((l) => l.open());
  if (layer) {
    layer.close();
    return;
  }
  // Nothing left to unwind: Back on the root screen exits, which is the Android
  // convention. No "are you sure?" — the comic is already saved (flushSave on
  // every edit), so there is nothing to protect the user from, and a confirm on
  // exit is the kind of thing that makes an app feel like it won't let you go.
  flushSave();
  CapacitorApp.exitApp();
}).catch(() => {
  // Web/dev: the plugin is a no-op outside the native shell and never fires.
});

// First paint: an incoming share link wins if present (a launch-by-link is
// asking for that comic, not the last one), otherwise pick up where the last
// session left off — the open draft, or the most recently saved one. If there's
// nothing to restore (genuine first run, cleared storage, or saves too damaged
// to trust) a fixed welcome comic, so a first launch is the same every time.
migrateLegacySession(KNOWN_CHARACTERS);
if (!consumeShareFromHash()) {
  const openId = getCurrentId();
  const restored =
    (openId ? loadDraft(openId, KNOWN_CHARACTERS) : null) ?? listDrafts(KNOWN_CHARACTERS)[0] ?? null;
  if (restored) hydrate(restored);
  else {
    setCurrentId(currentId);
    loadSeed(7);
  }
}

// A share link pasted into the WebView mid-session (rare, but the natural test
// path under `devserve.py`) imports as a new draft too — the running comic is
// already autosaved and stays intact in the library.
window.addEventListener('hashchange', () => { consumeShareFromHash(); });

// The walkthrough goes last, so it opens over a comic rather than a blank screen
// — the panels behind it are what the instructions are talking about.
if (!hasSeenIntro()) openIntro();
