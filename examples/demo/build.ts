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

// Chakra Petch (SIL OFL) — the Onion Madder brand face — embedded as a data URI
// so the page stays self-contained and matches the neon house style.
const fontData = readFileSync(join(here, 'assets', 'ChakraPetch-Regular.ttf')).toString('base64');
const fontFace =
  `@font-face{font-family:'Chakra Petch';font-style:normal;font-weight:400 700;font-display:swap;` +
  `src:url(data:font/ttf;base64,${fontData}) format('truetype')}`;

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
  ${fontFace}
  :root{
    --bg-deep:#050505; --panel:rgba(10,0,15,.85); --tile:rgba(20,0,30,.6); --tile-hover:rgba(30,0,50,.85);
    --pink:#ff2bb3; --cyan:#26ffe6; --amber:#ffbf00; --violet:#a95eff; --lime:#5fc944;
    --text:#e6e3ec; --dim:#948ca1;
    --border-sharp:rgba(169,94,255,.45); --border-soft:rgba(169,94,255,.18);
    --glow-cyan:0 0 6px rgba(38,255,230,.45); --glow-pink:0 0 6px rgba(255,43,179,.45);
    --shadow-card:0 2px 14px rgba(0,0,0,.5); --shadow-hover:0 6px 22px rgba(38,255,230,.18);
    --focus:0 0 0 2px var(--bg-deep),0 0 0 4px var(--cyan);
    --radius:8px; --t:.2s ease;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg-deep);color:var(--text);
    font:15px/1.55 'Chakra Petch',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;
    background-image:radial-gradient(1200px 600px at 15% -10%,rgba(169,94,255,.10),transparent 60%),radial-gradient(1000px 500px at 100% 0%,rgba(38,255,230,.06),transparent 55%);}
  ::selection{background:var(--pink);color:#000}
  .wrap{max-width:1180px;margin:0 auto;padding:26px 22px 70px}
  header.top{display:flex;align-items:center;gap:14px;margin:4px 0 26px}
  .logo{width:44px;height:44px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;
    color:var(--cyan);border:1px solid var(--cyan);background:rgba(38,255,230,.06);box-shadow:var(--glow-cyan)}
  .logo svg{width:24px;height:24px}
  .brand h1{font-size:22px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0;line-height:1.05;
    color:var(--pink);text-shadow:0 0 12px rgba(255,43,179,.35)}
  .brand p{margin:3px 0 0;color:var(--dim);font-size:13px;letter-spacing:.3px}
  .workspace{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
  .card{background:var(--panel);border:1px solid var(--border-soft);border-radius:var(--radius);box-shadow:var(--shadow-card);backdrop-filter:blur(6px)}
  .card>.hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-soft)}
  .card>.hd .t{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--cyan)}
  .card>.bd{padding:16px}
  .linkbtn{background:none;border:0;color:var(--pink);font:inherit;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;cursor:pointer;padding:0}
  .linkbtn:hover{text-shadow:var(--glow-pink)}
  textarea{width:100%;height:230px;resize:vertical;border:1px solid var(--border-sharp);border-radius:var(--radius);
    padding:12px 13px;background:#000;color:var(--text);font:13px/1.7 ui-monospace,"JetBrains Mono","IBM Plex Mono",Consolas,monospace}
  textarea:focus,select:focus,input:focus{outline:none;box-shadow:var(--glow-cyan);border-color:var(--cyan)}
  .help{margin-top:12px}
  .help summary{cursor:pointer;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:1.5px;list-style:none}
  .help summary:hover{color:var(--cyan)}
  .help summary::-webkit-details-marker{display:none}
  .help summary::before{content:"\\203A";display:inline-block;margin-right:6px;color:var(--cyan);transition:transform .15s}
  .help[open] summary::before{transform:rotate(90deg)}
  .help-body{margin-top:11px;padding:13px;border:1px dashed var(--border-soft);border-radius:var(--radius);background:var(--tile);font-size:13px}
  .help-body p{margin:0 0 9px}
  .hint-row{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin:5px 0}
  .hint-label{color:var(--dim);min-width:80px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px}
  code{background:rgba(38,255,230,.08);color:var(--cyan);border:1px solid rgba(38,255,230,.2);padding:1px 6px;border-radius:5px;font:12px ui-monospace,"JetBrains Mono",monospace}
  .setting{margin-bottom:15px}
  .setting>label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:5px}
  select,input[type=number]{width:100%;height:38px;border:1px solid var(--border-sharp);border-radius:var(--radius);background:#000;color:var(--text);padding:0 11px;font:inherit;font-size:14px}
  select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%2326ffe6' stroke-width='2'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;cursor:pointer}
  .seedrow{display:flex;gap:8px}
  .seedrow input{flex:1}
  .btn{height:38px;padding:0 14px;border-radius:var(--radius);border:1px solid var(--cyan);background:transparent;color:var(--cyan);
    font:inherit;font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:1.5px;cursor:pointer;
    display:inline-flex;align-items:center;gap:6px;justify-content:center;transition:var(--t)}
  .btn:hover{background:var(--cyan);color:#000;box-shadow:var(--glow-cyan)}
  .btn.icon{flex:0 0 auto;width:38px;padding:0;font-size:16px}
  .btn.primary{border-color:var(--pink);color:var(--pink)}
  .btn.primary:hover{background:var(--pink);color:#000;box-shadow:var(--glow-pink)}
  .toggle{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--dim)}
  .toggle input{appearance:none;width:34px;height:20px;border-radius:20px;background:#000;border:1px solid var(--border-sharp);position:relative;cursor:pointer;transition:var(--t);flex:0 0 auto}
  .toggle input:checked{background:rgba(38,255,230,.2);border-color:var(--cyan);box-shadow:var(--glow-cyan)}
  .toggle input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dim);transition:var(--t)}
  .toggle input:checked::after{left:15px;background:var(--cyan)}
  .divider{height:1px;background:var(--border-soft);margin:16px 0}
  .exports{display:flex;gap:8px}
  .exports .btn{flex:1}
  .section-label{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--pink);margin:28px 0 12px;display:flex;align-items:center;gap:10px}
  .section-label::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--border-sharp),transparent)}
  #status{color:var(--dim);font-size:11px;letter-spacing:.5px}
  #cast{display:flex;flex-wrap:wrap;gap:9px}
  .chip{display:inline-flex;align-items:center;gap:8px;padding:5px 7px 5px 13px;border:1px solid var(--border-sharp);border-radius:999px;background:var(--tile);transition:var(--t)}
  .chip:hover{border-color:var(--cyan);box-shadow:var(--glow-cyan)}
  .chip.is-manual{border-color:var(--pink);box-shadow:var(--glow-pink)}
  .chip .who{font-weight:700;font-size:13px;color:var(--text)}
  .chip .arr{color:var(--dim);font-size:10px;text-transform:uppercase;letter-spacing:1px}
  .chip select{height:30px;border:none;background:transparent;box-shadow:none;padding:0 22px 0 8px;width:auto;color:var(--cyan);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='none' stroke='%2326ffe6' stroke-width='2'%3E%3Cpath d='M1 3l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;font-weight:700;cursor:pointer}
  #out{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:18px}
  figure.panel{margin:0}
  .frame{background:#000;border:1px solid var(--border-sharp);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-card);transition:var(--t)}
  figure.panel:hover .frame{transform:translateY(-3px);border-color:var(--cyan);box-shadow:var(--shadow-hover)}
  .frame svg{display:block;width:100%;height:auto}
  figcaption{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--dim)}
  .pn{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:4px;background:var(--pink);color:#000;font-size:10px;font-weight:700}
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
            <p style="margin:9px 0 0;color:var(--dim)">Emoticons, <code>LOL</code>/<code>IMHO</code> and ALL-CAPS are still detected automatically when you don't give a hint.</p>
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
