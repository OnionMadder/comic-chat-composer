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
import { loadCharacters, loadBackdrops } from '../load-assets.ts';
import { HINT_WORDS } from '../parse-log.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'assets', 'comic-chat');

// Every bundled Comic Chat character (manifest + sprite markup) and backdrop,
// inlined so the page is self-contained.
const loaded = loadCharacters(join(root, 'characters'));
const manifests: Record<string, unknown> = {};
const sprites: Record<string, Record<string, string>> = {};
for (const [cid, { manifest, sprites: s }] of Object.entries(loaded)) {
  manifests[cid] = manifest;
  sprites[cid] = s;
}
const backdrops = loadBackdrops(join(root, 'backdrops'));

console.log(`inlining ${Object.keys(manifests).length} characters, ${Object.keys(backdrops).length} backdrops`);

const bundle = await esbuild.build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  define: {
    __MANIFESTS__: JSON.stringify(manifests),
    __SPRITES__: JSON.stringify(sprites),
    __BACKDROPS__: JSON.stringify(backdrops),
  },
});

const js = bundle.outputFiles[0]!.text;

const DEFAULT_LOG = `alice: Hi Bob!
bob -> alice (laugh): Hey Alice, you're back
* alice waves cheerfully
alice -> bob (happy): I missed you
bob -> alice: IMHO you should visit more often
cara (think): are they always like this?
cara -> alice (angry): Did you two start without me?!
alice -> cara (coy): never :-)
bob (whisper): we totally did`;

const hintLine = (label: string, words: string[]): string =>
  `<div class="hint-row"><span class="hint-label">${label}</span>` +
  words.map((w) => `<code>${w}</code>`).join(' ') +
  `</div>`;

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sceneOptions =
  `<option value="">Auto (from seed)</option>` +
  Object.keys(backdrops)
    .sort()
    .map((id) => `<option value="${id}">${titleCase(id)}</option>`)
    .join('');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>comic-chat-composer</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f4f4f0; --fg: #111; --muted: #667; --line: #d8d8d2;
    --field: #fff; --field-border: #ccc; --chip: #fff; --accent: #2b6cb0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a; --fg: #eee; --muted: #9a9aa2; --line: #2c2c33;
      --field: #202028; --field-border: #3a3a44; --chip: #24242c; --accent: #6aa6e0;
    }
  }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.5 system-ui, -apple-system, sans-serif;
    margin: 0; padding: 24px; max-width: 1500px;
    background: var(--bg); color: var(--fg);
  }
  h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 0 0 18px; }
  .controls { display: flex; flex-wrap: wrap; gap: 18px; align-items: stretch; margin-bottom: 14px; }
  .editor { display: flex; flex-direction: column; gap: 8px; flex: 1 1 460px; min-width: 300px; }
  textarea {
    width: 100%; height: 210px; padding: 11px 12px;
    font: 13px/1.6 ui-monospace, "SF Mono", Menlo, monospace;
    border: 1px solid var(--field-border); border-radius: 10px; resize: vertical;
    background: var(--field); color: var(--fg);
  }
  textarea:focus, select:focus, input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .side { display: flex; flex-direction: column; gap: 12px; font-size: 13px; flex: 0 0 200px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field > span { color: var(--muted); font-size: 12px; }
  input[type=number], .side select { width: 100%; padding: 7px 8px; border: 1px solid var(--field-border); border-radius: 7px; background: var(--field); color: var(--fg); font: inherit; }
  .row { display: flex; gap: 8px; align-items: center; }
  button {
    padding: 7px 12px; border-radius: 7px; border: 1px solid var(--field-border);
    background: var(--chip); color: inherit; cursor: pointer; font: inherit;
  }
  button:hover { border-color: var(--accent); }
  label.check { display: flex; gap: 7px; align-items: center; color: var(--muted); cursor: pointer; }
  .save { border-top: 1px solid var(--line); padding-top: 12px; margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
  .cols { width: 60px; }

  details.help { margin: 0 0 6px; font-size: 13px; }
  details.help summary { cursor: pointer; color: var(--accent); }
  .help-body { margin: 8px 0 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--chip); }
  .help-body p { margin: 0 0 8px; }
  .hint-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin: 4px 0; }
  .hint-label { color: var(--muted); min-width: 92px; font-size: 12px; }
  code { background: rgba(128,128,128,.16); padding: 1px 6px; border-radius: 5px; font-size: 12px; }

  #cast { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 12px; }
  #cast:empty { display: none; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 11px;
    border: 1px solid var(--field-border); border-radius: 999px; background: var(--chip); font-size: 13px;
  }
  .chip[data-manual] { border-color: var(--accent); }
  .chip .who { font-weight: 600; }
  .chip select { border: none; background: transparent; color: inherit; font: inherit; padding: 3px 2px; border-radius: 6px; cursor: pointer; }
  .cast-hint { align-self: center; color: var(--muted); font-size: 12px; }

  #status { font-size: 13px; color: var(--muted); margin-bottom: 14px; }
  #out { display: flex; flex-wrap: wrap; gap: 18px; }
  figure { margin: 0; }
  .frame svg { display: block; max-width: 100%; height: auto; border-radius: 5px; box-shadow: 0 1px 4px rgba(0,0,0,.14); }
  figcaption { font-size: 11px; color: var(--muted); margin-top: 5px; text-align: center; }
</style>

<h1>comic-chat-composer</h1>
<p class="lede">Turn a chat log into a comic. Type below — it recomposes as you go.</p>

<div class="controls">
  <div class="editor">
    <textarea id="log" spellcheck="false" aria-label="Chat log">${DEFAULT_LOG}</textarea>
    <details class="help">
      <summary>Line format &amp; directions</summary>
      <div class="help-body">
        <p>
          <code>alice: hello</code> &nbsp;
          <code>alice -&gt; bob: hello</code> (to someone) &nbsp;
          <code>* alice waves</code> (action)
        </p>
        <p>Add a hint in parentheses to direct a line — <code>alice (angry): no way</code>:</p>
        ${hintLine('emotions', HINT_WORDS.expressions)}
        ${hintLine('gestures', HINT_WORDS.gestures)}
        ${hintLine('balloon', HINT_WORDS.kinds)}
        <p class="cast-hint" style="margin:8px 0 0">Emoticons and <code>LOL</code>/<code>IMHO</code>/caps are still detected automatically when you don't give a hint.</p>
      </div>
    </details>
  </div>
  <div class="side">
    <label class="field"><span>Scene</span><select id="scene">${sceneOptions}</select></label>
    <label class="field"><span>Seed</span><input id="seed" type="number" value="1234"></label>
    <button id="reseed">Randomise cast &amp; seed</button>
    <label class="check"><input id="debug" type="checkbox"> Show layout guides</label>
    <div class="save">
      <label class="field"><span>Save strip — columns</span><input id="cols" class="cols" type="number" min="1" max="8" value="3"></label>
      <div class="row">
        <button id="dl-png">Download PNG</button>
        <button id="dl-svg">Download SVG</button>
      </div>
    </div>
  </div>
</div>

<div id="cast"></div>
<div id="status"></div>
<div id="out"></div>

<script>${js}</script>
</html>
`;

const outPath = join(here, 'index.html');
writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
