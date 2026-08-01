/**
 * Saved comics for mComic '96.
 *
 * Started as a single autosaved session; now a small library of drafts. Each
 * draft lives under its own `mcomic96:draft:<id>` key, with the active one
 * named by `mcomic96:current`. Per-draft keys rather than one array because
 * the autosave then rewrites only the comic you're working on — a bad write
 * can't take the whole library with it — and the draft list needs no separate
 * index to drift out of sync, since it's just a scan of the key prefix.
 *
 * `localStorage` rather than Capacitor Preferences: no extra plugin, no async
 * API to thread through every mutator, and identical behaviour under
 * `devserve.py` and in the packaged APK. What we store is text and ids — the
 * sprites live in the bundle — so a comic is well under a kilobyte.
 */

import type { ChatEvent, MessageEvent } from '../src/types.ts';

/** Per-beat character placement overrides. Mirrors the type in `main.ts`. */
export interface StoredOverrides {
  facing?: Record<string, 'left' | 'right'>;
  order?: string[];
}

/** The export sheet's remembered settings. */
export interface StoredExport {
  title?: string;
  subtitle?: string;
  columns?: number;
  credits?: boolean;
}

/**
 * One saved comic.
 *
 * `v` is checked on load and a mismatch is discarded rather than migrated —
 * losing one in-progress comic across an app update beats restoring something
 * malformed into a schema that no longer describes it.
 */
export interface SavedComic {
  v: 1;
  id: string;
  /** Filing label shown in the library. Distinct from the export title band. */
  name: string;
  /** True once the user renames by hand, which stops the auto-naming. */
  nameIsCustom: boolean;
  cast: string[];
  events: ChatEvent[];
  scene: string;
  seed: number;
  speaker: string;
  /**
   * Overrides as pairs, not an object. The `Map` is keyed by numeric
   * `event.at`; JSON object keys are always strings, so an object round-trip
   * would quietly turn every key into `"12"` and break each lookup.
   */
  overrides: Array<[number, StoredOverrides]>;
  export?: StoredExport;
  /** Whether the user has edited since the last dice roll (guards the roll). */
  touched: boolean;
  savedAt: number;
}

const DRAFT_PREFIX = 'mcomic96:draft:';
const CURRENT_KEY = 'mcomic96:current';
/** Set once the first-launch walkthrough has been dismissed. */
const INTRO_KEY = 'mcomic96:intro-seen';
/** The pre-library single-session key, migrated on first launch then removed. */
const LEGACY_KEY = 'mcomic96:session:v1';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Event types the app puts in `state.events`. Anything else is discarded. */
const EVENT_TYPES = new Set(['message', 'action', 'reaction', 'break', 'join', 'leave']);

export function newDraftId(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * A filing label taken from the comic's opening line, so drafts are
 * distinguishable without the user having to name anything.
 */
export function autoName(events: readonly ChatEvent[]): string {
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'action') continue;
    const text = (e as MessageEvent).text?.trim();
    if (text) return text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  }
  return 'Untitled comic';
}

/**
 * Parse and sanity-check a stored payload.
 *
 * The value is hand-editable in devtools and version-skewed across app
 * updates, so nothing here is trusted. Every failure path returns `null`; the
 * caller falls back to a fresh comic. A corrupt save must never strand the user
 * on a blank screen.
 *
 * `knownCharacters` is the live manifest key set — a character dropped from the
 * art set between releases is pruned rather than left to fail at render.
 *
 * Missing `id` / `name` are filled rather than rejected, which is what lets a
 * pre-library session payload migrate straight through this function.
 */
export function parseSaved(raw: string, knownCharacters: ReadonlySet<string>): SavedComic | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || data['v'] !== 1) return null;
  if (!Array.isArray(data['events']) || !Array.isArray(data['cast'])) return null;

  const cast = (data['cast'] as unknown[]).filter(
    (id): id is string => typeof id === 'string' && knownCharacters.has(id),
  );
  if (cast.length === 0) return null;

  const castSet = new Set(cast);
  const events = (data['events'] as unknown[]).filter((e): e is ChatEvent => {
    if (!isObject(e)) return false;
    if (typeof e['type'] !== 'string' || !EVENT_TYPES.has(e['type'])) return false;
    if (typeof e['at'] !== 'number') return false;
    // Breaks carry no author; everything else must belong to a surviving cast member.
    if (e['type'] === 'break') return true;
    return typeof e['author'] === 'string' && castSet.has(e['author']);
  });
  if (!events.some((e) => e.type !== 'break' && e.type !== 'join')) return null;

  const overrides: Array<[number, StoredOverrides]> = [];
  if (Array.isArray(data['overrides'])) {
    for (const pair of data['overrides'] as unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [at, ov] = pair as [unknown, unknown];
      if (typeof at !== 'number' || !isObject(ov)) continue;
      const clean: StoredOverrides = {};
      if (isObject(ov['facing'])) {
        const facing: Record<string, 'left' | 'right'> = {};
        for (const [cid, dir] of Object.entries(ov['facing'])) {
          if (castSet.has(cid) && (dir === 'left' || dir === 'right')) facing[cid] = dir;
        }
        if (Object.keys(facing).length) clean.facing = facing;
      }
      if (Array.isArray(ov['order'])) {
        const order = (ov['order'] as unknown[]).filter(
          (id): id is string => typeof id === 'string' && castSet.has(id),
        );
        if (order.length) clean.order = order;
      }
      if (clean.facing || clean.order) overrides.push([at, clean]);
    }
  }

  const speaker = typeof data['speaker'] === 'string' && castSet.has(data['speaker'])
    ? data['speaker']
    : cast[0]!;

  const exp = isObject(data['export']) ? data['export'] : undefined;
  const savedExport: StoredExport | undefined = exp
    ? {
        title: typeof exp['title'] === 'string' ? exp['title'] : undefined,
        subtitle: typeof exp['subtitle'] === 'string' ? exp['subtitle'] : undefined,
        columns: typeof exp['columns'] === 'number' ? exp['columns'] : undefined,
        credits: typeof exp['credits'] === 'boolean' ? exp['credits'] : undefined,
      }
    : undefined;

  const nameIsCustom = data['nameIsCustom'] === true;
  const storedName = typeof data['name'] === 'string' ? data['name'].trim() : '';

  return {
    v: 1,
    id: typeof data['id'] === 'string' && data['id'] ? data['id'] : newDraftId(),
    name: storedName || autoName(events),
    nameIsCustom: nameIsCustom && storedName !== '',
    cast,
    events,
    scene: typeof data['scene'] === 'string' ? data['scene'] : '',
    seed: typeof data['seed'] === 'number' ? data['seed'] : 1,
    speaker,
    overrides,
    export: savedExport,
    touched: data['touched'] === true,
    savedAt: typeof data['savedAt'] === 'number' ? data['savedAt'] : 0,
  };
}

// ---- localStorage plumbing ------------------------------------------------

const get = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage disabled (private mode, locked-down WebView)
  }
};

const put = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota or disabled storage. Losing a save is not worth breaking the UI over.
  }
};

const drop = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
};

/** Every draft key currently present, unparsed. */
function draftKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) out.push(k);
    }
  } catch {
    return [];
  }
  return out;
}

// ---- The library ----------------------------------------------------------

/** Every readable draft, newest first. Unreadable ones are dropped, not thrown. */
export function listDrafts(knownCharacters: ReadonlySet<string>): SavedComic[] {
  const out: SavedComic[] = [];
  for (const key of draftKeys()) {
    const raw = get(key);
    const parsed = raw ? parseSaved(raw, knownCharacters) : null;
    if (parsed) out.push(parsed);
    else drop(key); // don't re-parse a bad payload on every launch
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function loadDraft(id: string, knownCharacters: ReadonlySet<string>): SavedComic | null {
  const raw = get(DRAFT_PREFIX + id);
  return raw ? parseSaved(raw, knownCharacters) : null;
}

export function saveDraft(comic: SavedComic): void {
  put(DRAFT_PREFIX + comic.id, JSON.stringify(comic));
}

export function deleteDraft(id: string): void {
  drop(DRAFT_PREFIX + id);
}

/**
 * Has the walkthrough been dismissed before?
 *
 * Defaults to "yes, seen" if storage is unavailable — an unreadable store would
 * otherwise reintroduce the intro on every single launch, which is far more
 * annoying than never showing it. The `?` button reaches it either way.
 */
export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) !== null;
  } catch {
    return true;
  }
}

export function markIntroSeen(): void {
  put(INTRO_KEY, '1');
}

export function getCurrentId(): string | null {
  return get(CURRENT_KEY);
}

export function setCurrentId(id: string): void {
  put(CURRENT_KEY, id);
}

/**
 * Fold a pre-library session into the draft library, once.
 *
 * Persistence shipped before the library did, so an existing user has real work
 * under the old single-session key. Move it across rather than stranding it.
 */
export function migrateLegacySession(knownCharacters: ReadonlySet<string>): void {
  const raw = get(LEGACY_KEY);
  if (!raw) return;
  const parsed = parseSaved(raw, knownCharacters);
  if (parsed) {
    saveDraft(parsed);
    setCurrentId(parsed.id);
  }
  drop(LEGACY_KEY);
}
