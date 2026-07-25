/**
 * Load character and backdrop art from disk into the inline markup the
 * reference renderer expects.
 *
 * Sprites come in two flavours and this hides the difference from the renderer:
 *
 * - **SVG** (the hand-drawn `nib`): the inner markup is inlined directly, so it
 *   scales as vector and the §6.1 halo can restroke it.
 * - **PNG** (imported Comic Chat art): emitted as an `<image>` with a data URI
 *   and the pixel size read from the PNG header, so it needs no external file.
 *
 * A Node-only helper — it reads files. The browser demo calls it at build time
 * and inlines the result.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CharacterManifest } from '../src/manifest.ts';
import { parseCharacterManifest } from '../src/manifest.ts';

/** Strip the outer `<svg>` wrapper so the art can be positioned with `<g>`. */
function innerSvg(raw: string): string {
  return raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
}

/** PNG intrinsic size, from the IHDR width/height at bytes 16–24. */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function spriteMarkup(dir: string, file: string): string {
  if (file.endsWith('.svg')) return innerSvg(readFileSync(join(dir, file), 'utf8'));
  const buf = readFileSync(join(dir, file));
  const { width, height } = pngSize(buf);
  return `<image href="data:image/png;base64,${buf.toString('base64')}" width="${width}" height="${height}"/>`;
}

export interface LoadedCharacter {
  manifest: CharacterManifest;
  /** Sprite markup keyed by the manifest `src` filename. */
  sprites: Record<string, string>;
}

/** Load one character directory (its `character.json` and every sprite). */
export function loadCharacter(dir: string): LoadedCharacter {
  const manifest = parseCharacterManifest(
    JSON.parse(readFileSync(join(dir, 'character.json'), 'utf8')),
  );
  const sprites: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.svg') || file.endsWith('.png')) {
      sprites[file] = spriteMarkup(dir, file);
    }
  }
  return { manifest, sprites };
}

/** Load every character directory under `root`, keyed by character id. */
export function loadCharacters(root: string): Record<string, LoadedCharacter> {
  const out: Record<string, LoadedCharacter> = {};
  for (const cid of readdirSync(root)) {
    try {
      out[cid] = loadCharacter(join(root, cid));
    } catch {
      // Skip directories that are not characters.
    }
  }
  return out;
}

/**
 * Load backdrop art keyed by id. PNGs are emitted as an `<image>` that covers a
 * generous world rectangle (so establishing shots still find art at the edges)
 * with `slice` scaling, so the square source fills without distortion. SVGs are
 * inlined as-is. Both are drawn through the camera transform (§6.2).
 */
export function loadBackdrops(
  root: string,
  world = { x: -160, y: -110, width: 720, height: 470 },
  opacity = 0.62,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(root)) {
    const id = file.replace(/\.(png|svg)$/, '');
    if (file.endsWith('.svg')) {
      out[id] = innerSvg(readFileSync(join(root, file), 'utf8'));
    } else if (file.endsWith('.png')) {
      const buf = readFileSync(join(root, file));
      // Comic Chat backdrops are dense black line art. A light scrim keeps them
      // authentic but stops them fighting the characters — the §6.1 halos do
      // the rest. `slice` fills the square source into the world box uncropped.
      out[id] =
        `<image href="data:image/png;base64,${buf.toString('base64')}" ` +
        `x="${world.x}" y="${world.y}" width="${world.width}" height="${world.height}" ` +
        `preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>`;
    }
  }
  return out;
}
