/**
 * Builds `examples/demo/index.html` — a single self-contained page with the
 * composer, the reference renderer and every sprite inlined.
 *
 * No external requests, no server required: open it from disk or drop it on
 * any static host.
 *
 * Run with:  npm run demo
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = join(here, '..', '..', 'assets', 'characters', 'nib');

const manifest = JSON.parse(readFileSync(join(assetDir, 'character.json'), 'utf8'));

/** Strip the outer `<svg>` wrapper so sprites can be positioned with `<g>`. */
const sprites: Record<string, string> = {};
for (const file of readdirSync(assetDir)) {
  if (!file.endsWith('.svg')) continue;
  const raw = readFileSync(join(assetDir, file), 'utf8');
  sprites[file] = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
}

const bundle = await esbuild.build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  define: {
    __SPRITES__: JSON.stringify(sprites),
    __MANIFEST__: JSON.stringify(manifest),
  },
});

const js = bundle.outputFiles[0]!.text;

const DEFAULT_LOG = `alice: Hi Bob!
bob -> alice: Hey Alice, LOL you're back
* alice waves cheerfully
alice -> bob: I MISSED YOU!!!
bob -> alice: IMHO you should visit more often
cara: Did you two start without me? :-(
alice -> cara: never :-)`;

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>comic-chat-composer demo</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 14px/1.5 system-ui, sans-serif;
    margin: 0; padding: 24px;
    background: #f4f4f0; color: #111;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #16161a; color: #eee; }
    textarea, input { background: #222; color: #eee; border-color: #444; }
    .panel-note { color: #999; }
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .panel-note { color: #666; margin: 0 0 20px; }
  .controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; margin-bottom: 20px; }
  textarea {
    width: min(520px, 100%); height: 170px; padding: 10px;
    font: 13px/1.5 ui-monospace, monospace;
    border: 1px solid #ccc; border-radius: 8px; resize: vertical;
  }
  .side { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
  input[type=number] { width: 100px; padding: 6px; border: 1px solid #ccc; border-radius: 6px; }
  button { padding: 6px 12px; border-radius: 6px; border: 1px solid #888; background: transparent; color: inherit; cursor: pointer; }
  #status { font-size: 13px; color: #666; margin-bottom: 12px; }
  #out { display: flex; flex-wrap: wrap; gap: 18px; }
  figure { margin: 0; }
  .frame svg { display: block; max-width: 100%; height: auto; border-radius: 4px; }
  figcaption { font-size: 11px; color: #888; margin-top: 5px; text-align: center; }
  code { background: rgba(128,128,128,.18); padding: 1px 5px; border-radius: 4px; }
</style>

<h1>comic-chat-composer</h1>
<p class="panel-note">
  Type a chat log. Formats: <code>alice: hello</code>,
  <code>alice -&gt; bob: hello</code> (explicit addressee),
  <code>* alice waves</code> (action).
</p>

<div class="controls">
  <textarea id="log" spellcheck="false">${DEFAULT_LOG}</textarea>
  <div class="side">
    <label>Seed<br><input id="seed" type="number" value="1234"></label>
    <button id="reseed">Randomise seed</button>
    <label><input id="debug" type="checkbox"> Show layout guides</label>
  </div>
</div>

<div id="status"></div>
<div id="out"></div>

<script>${js}</script>
</html>
`;

const outPath = join(here, 'index.html');
writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
