/**
 * Share links for mComic '96.
 *
 * A composed comic packs into the URL hash so it can be sent to someone. The
 * app decodes on boot (and on `hashchange`), hydrating the shared comic as a
 * new draft — the current draft is never overwritten by an incoming link.
 *
 * Format: `#c=<base64url of UTF-8 JSON>`. `#c=` matches the web demo's prefix
 * on purpose, so a future demo release can learn to decode the app format too.
 * The payload itself differs: the demo stores a `script` string that cannot
 * round-trip `reaction` events or the app's `BeatOverrides`, so the app packs
 * its actual {@link ChatEvent}[] instead — same reason the saved-draft format
 * does. Decoders here treat everything as untrusted; any failure returns
 * `null` and the caller falls back to normal boot.
 */

import type { ChatEvent } from '../src/types.ts';
import type { StoredOverrides } from './storage.ts';

/**
 * The URL prefix a share link opens.
 *
 * The composer's public mirror — same host the web demo lives on. Once Android
 * App Links are wired (a later release), tapping a link on a device with the
 * app installed will open it there instead of the browser.
 */
export const SHARE_SITE = 'https://onionmadder.com/comic-chat-composer/';

/**
 * The shape that goes on the wire.
 *
 * Kept flat and short-keyed to keep the URL a manageable length — a small
 * comic packs to a few hundred characters. `overrides` is an array of pairs
 * for the same reason the saved-draft format uses one: the `Map` is keyed by
 * numeric `event.at`, and a JSON object round-trip would silently stringify
 * every key.
 */
export interface ShareState {
  v: 1;
  events: ChatEvent[];
  cast: string[];
  scene: string;
  seed: number;
  speaker: string;
  overrides: Array<[number, StoredOverrides]>;
  /** Title band on the exported strip, echoed above the on-screen comic. */
  t?: string;
  st?: string;
  /**
   * Sender's handle for attribution ("Shared by Sam"). Optional — an unset
   * handle just means the share is anonymous. Trimmed at encode time; capped
   * at 40 chars at decode time so a hostile payload can't shove megabytes of
   * "handle" past the tolerant reader.
   */
  by?: string;
}

/** UTF-8-safe base64url, so lines with punctuation or emoji survive. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): string | null {
  try {
    const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Pack the app's live state into a share token (the part after `#c=`). */
export function encodeShare(state: ShareState): string {
  return toBase64Url(JSON.stringify(state));
}

/** Full share URL for the clipboard / share sheet. */
export function shareUrl(state: ShareState): string {
  return `${SHARE_SITE}#c=${encodeShare(state)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const EVENT_TYPES = new Set(['message', 'action', 'reaction', 'break', 'join', 'leave']);

/**
 * Parse and sanity-check a share token.
 *
 * The value came off the URL — nothing about it is trusted. `knownCharacters`
 * is the live manifest key set: a shared comic that names a character the
 * bundled art no longer includes has that character pruned rather than being
 * rejected outright. A payload with no surviving cast returns `null`, so boot
 * falls through to the normal restore path instead of stranding the user.
 */
export function decodeShare(token: string, knownCharacters: ReadonlySet<string>): ShareState | null {
  const raw = fromBase64Url(token);
  if (raw === null) return null;
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

  const by = typeof data['by'] === 'string' ? data['by'].trim().slice(0, 40) : undefined;

  return {
    v: 1,
    events,
    cast,
    scene: typeof data['scene'] === 'string' ? data['scene'] : '',
    seed: typeof data['seed'] === 'number' ? data['seed'] : 1,
    speaker,
    overrides,
    t: typeof data['t'] === 'string' ? data['t'] : undefined,
    st: typeof data['st'] === 'string' ? data['st'] : undefined,
    by: by || undefined,
  };
}

/** Read a share token out of the current URL hash, if any. */
export function tokenFromHash(hash: string): string | null {
  const match = /[#&]c=([^&]+)/.exec(hash);
  return match ? match[1]! : null;
}
