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
<title>Comic Chat Composer</title>
<style>
  :root{
    color-scheme:light dark;
    --bg:#efece4; --card:#fff; --ink:#17171a; --muted:#6b6b74; --panel:#f6f4ee;
    --line:#e4e0d6; --field:#fff; --fieldline:#d6d2c8; --accent:#e5383b; --accent-ink:#fff;
    --shadow:0 1px 2px rgba(20,18,14,.05),0 6px 18px rgba(20,18,14,.06);
    --radius:14px;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#131316; --card:#1e1e24; --ink:#ececf0; --muted:#9a9aa5; --panel:#191920;
    --line:#2c2c34; --field:#232329; --fieldline:#3a3a44; --accent:#ff6b6e; --accent-ink:#1a1010;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:22px 22px 60px}
  header.top{display:flex;align-items:center;gap:13px;margin:6px 0 22px}
  .logo{width:40px;height:40px;flex:0 0 auto;background:var(--ink);border-radius:11px;display:grid;place-items:center;color:var(--bg)}
  .logo svg{width:23px;height:23px}
  .brand h1{font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0;line-height:1.1}
  .brand p{margin:1px 0 0;color:var(--muted);font-size:13.5px}
  .workspace{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
  .card>.hd{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line)}
  .card>.hd .t{font-weight:650;font-size:13px}
  .card>.bd{padding:16px}
  .linkbtn{background:none;border:0;color:var(--accent);font:inherit;font-size:12.5px;cursor:pointer;padding:0}
  .linkbtn:hover{text-decoration:underline}
  textarea{width:100%;height:230px;resize:vertical;border:1px solid var(--fieldline);border-radius:10px;
    padding:12px 13px;background:var(--field);color:var(--ink);font:13px/1.7 ui-monospace,"SF Mono",Menlo,monospace}
  textarea:focus,select:focus,input:focus{outline:2px solid var(--accent);outline-offset:1px}
  .help{margin-top:12px}
  .help summary{cursor:pointer;color:var(--muted);font-size:12.5px;list-style:none}
  .help summary::-webkit-details-marker{display:none}
  .help summary::before{content:"\\203A";display:inline-block;margin-right:6px;transition:transform .15s}
  .help[open] summary::before{transform:rotate(90deg)}
  .help-body{margin-top:10px;padding:13px;border:1px dashed var(--line);border-radius:10px;background:var(--panel);font-size:13px}
  .help-body p{margin:0 0 9px}
  .hint-row{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin:5px 0}
  .hint-label{color:var(--muted);min-width:80px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  code{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);padding:1.5px 6px;border-radius:6px;font:12px ui-monospace,monospace}
  .setting{margin-bottom:15px}
  .setting>label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:5px}
  select,input[type=number]{width:100%;height:38px;border:1px solid var(--fieldline);border-radius:9px;background:var(--field);color:var(--ink);padding:0 11px;font:inherit;font-size:14px}
  select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%236b6b74' stroke-width='2'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;cursor:pointer}
  .seedrow{display:flex;gap:8px}
  .seedrow input{flex:1}
  .btn{height:38px;padding:0 14px;border-radius:9px;border:1px solid var(--fieldline);background:var(--field);color:var(--ink);font:inherit;font-weight:550;font-size:13.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;justify-content:center}
  .btn:hover{border-color:var(--accent)}
  .btn.icon{flex:0 0 auto;width:38px;padding:0;font-size:16px}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .btn.primary:hover{filter:brightness(1.06)}
  .toggle{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13.5px;color:var(--muted)}
  .toggle input{appearance:none;width:34px;height:20px;border-radius:20px;background:var(--fieldline);position:relative;cursor:pointer;transition:background .15s;flex:0 0 auto}
  .toggle input:checked{background:var(--accent)}
  .toggle input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
  .toggle input:checked::after{left:16px}
  .divider{height:1px;background:var(--line);margin:16px 0}
  .exports{display:flex;gap:8px}
  .exports .btn{flex:1}
  .section-label{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 11px;display:flex;align-items:center;gap:9px}
  .section-label::after{content:"";flex:1;height:1px;background:var(--line)}
  #status{color:var(--muted);font-size:12px;font-weight:500;text-transform:none;letter-spacing:0}
  #cast{display:flex;flex-wrap:wrap;gap:9px}
  .chip{display:inline-flex;align-items:center;gap:8px;padding:5px 7px 5px 13px;border:1px solid var(--fieldline);border-radius:999px;background:var(--card);box-shadow:var(--shadow)}
  .chip.is-manual{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
  .chip .who{font-weight:650;font-size:13.5px}
  .chip .arr{color:var(--muted);font-size:11px}
  .chip select{height:30px;border:none;background:transparent;box-shadow:none;padding:0 22px 0 8px;width:auto;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='none' stroke='%236b6b74' stroke-width='2'%3E%3Cpath d='M1 3l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;font-weight:550;cursor:pointer}
  #out{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:18px}
  figure.panel{margin:0}
  .frame{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow);transition:transform .12s}
  figure.panel:hover .frame{transform:translateY(-2px)}
  .frame svg{display:block;width:100%;height:auto}
  figcaption{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:11.5px;color:var(--muted)}
  .pn{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--ink);color:var(--bg);font-size:10.5px;font-weight:700}
  @media (max-width:820px){.workspace{grid-template-columns:1fr}}
</style>

<div class="wrap">
  <header class="top">
    <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-4 4v-4H4z"/></svg></div>
    <div class="brand"><h1>Comic Chat Composer</h1><p>Turn a chat log into a comic strip &mdash; live.</p></div>
  </header>

  <div class="workspace">
    <div class="card">
      <div class="hd"><span class="t">Script</span><button id="example" class="linkbtn">Load example</button></div>
      <div class="bd">
        <textarea id="log" spellcheck="false" aria-label="Chat log">${DEFAULT_LOG}</textarea>
        <details class="help">
          <summary>Line format &amp; directions</summary>
          <div class="help-body">
            <p><code>alice: hello</code> &nbsp; <code>alice -&gt; bob: hello</code> (to someone) &nbsp; <code>* alice waves</code> (action)</p>
            <p>Direct a line with a hint &mdash; <code>alice (angry): no way</code>:</p>
            ${hintLine('emotions', HINT_WORDS.expressions)}
            ${hintLine('gestures', HINT_WORDS.gestures)}
            ${hintLine('balloon', HINT_WORDS.kinds)}
            <p style="margin:9px 0 0;color:var(--muted)">Emoticons, <code>LOL</code>/<code>IMHO</code> and ALL-CAPS are still detected automatically when you don't give a hint.</p>
          </div>
        </details>
      </div>
    </div>

    <div class="card"><div class="bd">
      <div class="setting"><label>Scene</label><select id="scene">${sceneOptions}</select></div>
      <div class="setting"><label>Seed</label>
        <div class="seedrow"><input id="seed" type="number" value="1234">
          <button id="reseed" class="btn icon" title="Randomise cast &amp; seed" aria-label="Randomise cast and seed">&#127922;</button>
        </div>
      </div>
      <label class="toggle"><input id="debug" type="checkbox"> Show layout guides</label>
      <div class="divider"></div>
      <div class="setting"><label>Save strip &mdash; columns</label><input id="cols" type="number" min="1" max="8" value="3"></div>
      <div class="exports"><button id="dl-png" class="btn primary">Download PNG</button><button id="dl-svg" class="btn">SVG</button></div>
    </div></div>
  </div>

  <div class="section-label">Cast</div>
  <div id="cast"></div>
  <div class="section-label">Comic <span id="status"></span></div>
  <div id="out"></div>
</div>

<script>${js}</script>
</html>
`;

const outPath = join(here, 'index.html');
writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
