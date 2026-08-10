/**
 * Local co-op mode for mComic '96 — the mechanic test for multiplayer.
 *
 * The cast splits into two sides; a panel is committed to one side at a time
 * (that side's characters supply every balloon in it); a Pass verb closes the
 * current panel and hands the next one to the other side. Everything else is
 * the ordinary compose flow. Purely local — no partner, no server — one user
 * role-plays both sides to feel whether panel-by-panel + one-side-per-turn
 * reads as *creation* or as slow chat with rules. If the answer is chat, the
 * real multiplayer never needs to be built.
 *
 * State persists in `localStorage` so a session-across-refresh test is easy:
 * side assignments survive, the current side and in-turn flag don't (they
 * reset to A / fresh each launch, which is the sensible default for a toy).
 */

const KEY = 'mcomic96:coop';

/**
 * Persisted co-op configuration.
 *
 * `sideA` / `sideB` are character ids drawn from the current draft's cast.
 * A character on neither list is "unassigned" — visible in the app, muted for
 * the duration of the co-op session (they'd have no side to belong to).
 */
export interface CoopConfig {
  enabled: boolean;
  sideA: string[];
  sideB: string[];
}

const DEFAULT: CoopConfig = { enabled: false, sideA: [], sideB: [] };

export function loadCoop(): CoopConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null) return { ...DEFAULT };
    const d = data as Record<string, unknown>;
    return {
      enabled: d['enabled'] === true,
      sideA: Array.isArray(d['sideA'])
        ? (d['sideA'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      sideB: Array.isArray(d['sideB'])
        ? (d['sideB'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveCoop(config: CoopConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Storage disabled — losing a config write beats breaking the UI.
  }
}

export type Side = 'A' | 'B';

/** Which side (if any) a character belongs to. */
export function sideOf(config: CoopConfig, characterId: string): Side | null {
  if (config.sideA.includes(characterId)) return 'A';
  if (config.sideB.includes(characterId)) return 'B';
  return null;
}

/**
 * Auto-assign a cast into two sides — first half A, second half B, keeping
 * the current order. The default when co-op is first enabled; the user can
 * re-split later. Odd cast counts favour side A by one.
 */
export function autoSplit(cast: readonly string[]): { sideA: string[]; sideB: string[] } {
  const mid = Math.ceil(cast.length / 2);
  return { sideA: [...cast.slice(0, mid)], sideB: [...cast.slice(mid)] };
}

/**
 * Reconcile the current side assignments against the draft's cast.
 *
 * A character removed from the cast gets pruned from its side. A character
 * added to the cast is dropped onto whichever side is shorter, so the sides
 * stay roughly balanced without the user having to think about it.
 */
export function reconcileSides(config: CoopConfig, cast: readonly string[]): CoopConfig {
  const inCast = new Set(cast);
  const sideA = config.sideA.filter((id) => inCast.has(id));
  const sideB = config.sideB.filter((id) => inCast.has(id));
  for (const id of cast) {
    if (sideA.includes(id) || sideB.includes(id)) continue;
    if (sideA.length <= sideB.length) sideA.push(id);
    else sideB.push(id);
  }
  return { ...config, sideA, sideB };
}
