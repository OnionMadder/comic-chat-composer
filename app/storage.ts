/**
 * Session persistence for mComic '96.
 *
 * The app had none: every launch started from a fresh dice roll and whatever
 * you wrote last time was gone. This keeps the working comic in `localStorage`
 * so closing the app — or Android killing a backgrounded WebView, which it does
 * without warning — costs nothing.
 *
 * `localStorage` rather than Capacitor Preferences: no extra plugin, no async
 * API to thread through every mutator, and identical behaviour under
 * `devserve.py` and in the packaged APK. What we store is text and ids — the
 * sprites live in the bundle, not in app state — so a comic is kilobytes
 * against a budget of about five megabytes.
 */

import type { ChatEvent } from '../src/types.ts';

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

const KEY = 'mcomic96:session:v1';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Event types the app puts in `state.events`. Anything else is discarded. */
const EVENT_TYPES = new Set(['message', 'action', 'reaction', 'break', 'join', 'leave']);

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

  return {
    v: 1,
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

/** Read the saved comic, or `null` if there isn't a usable one. */
export function loadSession(knownCharacters: ReadonlySet<string>): SavedComic | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null; // storage disabled (private mode, locked-down WebView)
  }
  if (!raw) return null;
  const parsed = parseSaved(raw, knownCharacters);
  if (!parsed) clearSession(); // don't re-parse a bad payload on every launch
  return parsed;
}

/** Write the comic. Silently gives up if storage is unavailable or full. */
export function saveSession(comic: SavedComic): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(comic));
  } catch {
    // Quota or disabled storage. Losing a save is not worth breaking the UI over.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
