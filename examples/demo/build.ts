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
import { CONVERSATIONS } from '../corpus.ts';
import { seededIndex } from '../../src/rng.ts';

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

// The initial script matches the conversation the demo's JS loads for seed 1234,
// so there's no swap-flash on load.
const DEFAULT_SEED = 1234;
const DEFAULT_LOG = CONVERSATIONS[seededIndex(DEFAULT_SEED, CONVERSATIONS.length)]!;

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

// --- Public site metadata -------------------------------------------------
// Fill these in for the hosted build: they drive the footer links and the
// canonical / Open Graph meta. Placeholders until the site + repo URLs exist.
const SITE_URL = 'https://onionmadder.com/comic-chat-composer/';
const REPO_URL = 'https://github.com/OnionMadder/comic-chat-composer';
const PAGE_DESC =
  'Turn a chat log into a comic strip — an independent, open-source ' +
  "reimplementation of Microsoft Comic Chat's panel-composition algorithm " +
  '(Kurlander, Skelly and Salesin, SIGGRAPH ’96). Not affiliated with Microsoft.';

// A speech-bubble favicon as an inline data URI, so the page stays self-contained.
const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
  "%3Crect width='32' height='32' rx='7' fill='%23050505'/%3E" +
  "%3Cpath d='M7 8h18v12H13l-5 5v-5H7z' fill='none' stroke='%2326ffe6' stroke-width='2.5' stroke-linejoin='round'/%3E%3C/svg%3E";

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comic Chat Composer</title>
<meta name="description" content="${PAGE_DESC}">
<meta name="theme-color" content="#050505">
<link rel="icon" href="${favicon}">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="Comic Chat Composer">
<meta property="og:description" content="${PAGE_DESC}">
<meta property="og:url" content="${SITE_URL}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Comic Chat Composer">
<meta name="twitter:description" content="${PAGE_DESC}">
<style>
  ${fontFace}
  :root{
    --bg-deep:#050505; --panel:rgba(10,0,15,.85); --tile:rgba(20,0,30,.6);
    --pink:#ff2bb3; --cyan:#26ffe6; --violet:#a95eff;
    --text:#f2f0f6; --dim:#c3bdd2;
    --border-sharp:rgba(169,94,255,.5); --border-soft:rgba(169,94,255,.22);
    --glow-cyan:0 0 7px rgba(38,255,230,.5); --glow-pink:0 0 7px rgba(255,43,179,.5);
    --shadow-card:0 2px 14px rgba(0,0,0,.5); --shadow-hover:0 6px 22px rgba(38,255,230,.2);
    --radius:8px; --t:.2s ease;
    /* Chakra Petch is the brand display face; body copy uses a plain readable
       sans so long text and the script stay legible (low-vision friendly). */
    --display:'Chakra Petch',system-ui,sans-serif;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,"JetBrains Mono","IBM Plex Mono",Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg-deep);color:var(--text);
    font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;
    background-image:radial-gradient(1200px 600px at 15% -10%,rgba(169,94,255,.10),transparent 60%),radial-gradient(1000px 500px at 100% 0%,rgba(38,255,230,.06),transparent 55%);}
  ::selection{background:var(--pink);color:#000}
  .wrap{max-width:1180px;margin:0 auto;padding:26px 22px 70px}
  header.top{display:flex;align-items:center;gap:14px;margin:4px 0 26px}
  .logo{width:46px;height:46px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;
    color:var(--cyan);border:1px solid var(--cyan);background:rgba(38,255,230,.06);box-shadow:var(--glow-cyan)}
  .logo svg{width:25px;height:25px}
  .brand h1{font-family:var(--display);font-size:26px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0;line-height:1.05;
    color:var(--pink);text-shadow:0 0 12px rgba(255,43,179,.4)}
  .brand p{margin:4px 0 0;color:var(--dim);font-size:15px}
  .workspace{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
  .card{background:var(--panel);border:1px solid var(--border-soft);border-radius:var(--radius);box-shadow:var(--shadow-card);backdrop-filter:blur(6px)}
  .card>.hd{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border-soft)}
  .card>.hd .t{font-family:var(--display);font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:1.5px;color:var(--cyan)}
  .card>.bd{padding:16px}
  .linkbtn{font-family:var(--display);background:none;border:0;color:var(--pink);font-size:13px;text-transform:uppercase;letter-spacing:1px;cursor:pointer;padding:0}
  .linkbtn:hover{text-shadow:var(--glow-pink)}
  textarea{width:100%;height:250px;resize:vertical;border:1px solid var(--border-sharp);border-radius:var(--radius);
    padding:13px 14px;background:#000;color:var(--text);font:15px/1.85 var(--mono)}
  textarea:focus,select:focus,input:focus{outline:none;box-shadow:var(--glow-cyan);border-color:var(--cyan)}
  .help{margin-top:12px}
  .help summary{font-family:var(--display);cursor:pointer;color:var(--dim);font-size:13px;text-transform:uppercase;letter-spacing:1px;list-style:none}
  .help summary:hover{color:var(--cyan)}
  .help summary::-webkit-details-marker{display:none}
  .help summary::before{content:"\\203A";display:inline-block;margin-right:6px;color:var(--cyan);transition:transform .15s}
  .help[open] summary::before{transform:rotate(90deg)}
  .help-body{margin-top:11px;padding:14px;border:1px dashed var(--border-soft);border-radius:var(--radius);background:var(--tile);font-size:14.5px;line-height:1.7}
  .help-body p{margin:0 0 10px}
  .hint-row{display:flex;flex-wrap:wrap;gap:7px;align-items:baseline;margin:6px 0}
  .hint-label{color:var(--dim);min-width:84px;font-size:12.5px;text-transform:uppercase;letter-spacing:.5px}
  code{background:rgba(38,255,230,.08);color:var(--cyan);border:1px solid rgba(38,255,230,.2);padding:2px 7px;border-radius:5px;font:13.5px var(--mono)}
  .setting{margin-bottom:16px}
  .setting>label{font-family:var(--display);display:block;font-size:12.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:6px}
  select,input[type=number]{width:100%;height:42px;border:1px solid var(--border-sharp);border-radius:var(--radius);background:#000;color:var(--text);padding:0 12px;font:15px var(--sans)}
  select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%2326ffe6' stroke-width='2'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center;padding-right:32px;cursor:pointer}
  .seedrow{display:flex;gap:8px}
  .seedrow input{flex:1}
  .btn{font-family:var(--display);height:42px;padding:0 15px;border-radius:var(--radius);border:1px solid var(--cyan);background:transparent;color:var(--cyan);
    font-weight:700;font-size:13.5px;text-transform:uppercase;letter-spacing:1px;cursor:pointer;
    display:inline-flex;align-items:center;gap:6px;justify-content:center;transition:var(--t)}
  .btn:hover{background:var(--cyan);color:#000;box-shadow:var(--glow-cyan)}
  .btn.icon{flex:0 0 auto;width:42px;padding:0;font-size:18px}
  .btn.primary{border-color:var(--pink);color:var(--pink)}
  .btn.primary:hover{background:var(--pink);color:#000;box-shadow:var(--glow-pink)}
  .toggle{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--dim)}
  .toggle input{appearance:none;width:38px;height:22px;border-radius:22px;background:#000;border:1px solid var(--border-sharp);position:relative;cursor:pointer;transition:var(--t);flex:0 0 auto}
  .toggle input:checked{background:rgba(38,255,230,.2);border-color:var(--cyan);box-shadow:var(--glow-cyan)}
  .toggle input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dim);transition:var(--t)}
  .toggle input:checked::after{left:17px;background:var(--cyan)}
  .divider{height:1px;background:var(--border-soft);margin:18px 0}
  .exports{display:flex;gap:8px}
  .exports .btn{flex:1}
  .section-label{font-family:var(--display);font-size:14px;text-transform:uppercase;letter-spacing:1.5px;color:var(--pink);margin:30px 0 13px;display:flex;align-items:center;gap:11px}
  .section-label::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--border-sharp),transparent)}
  #status{font-family:var(--sans);color:var(--dim);font-size:14px;letter-spacing:0;text-transform:none}
  #cast{display:flex;flex-wrap:wrap;gap:10px}
  .chip{display:inline-flex;align-items:center;gap:9px;padding:6px 8px 6px 12px;border:1px solid var(--border-sharp);border-radius:999px;background:var(--tile);transition:var(--t)}
  .chip:hover{border-color:var(--cyan);box-shadow:var(--glow-cyan)}
  .chip.is-manual{border-color:var(--pink);box-shadow:var(--glow-pink)}
  .chip .sw{width:11px;height:11px;border-radius:50%;background:var(--c,var(--dim));flex:0 0 auto;box-shadow:0 0 6px var(--c)}
  .chip .who{font-weight:700;font-size:15px;color:var(--text)}
  .chip .arr{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .chip select{height:32px;border:none;background:transparent;box-shadow:none;padding:0 24px 0 9px;width:auto;color:var(--cyan);font-size:15px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='none' stroke='%2326ffe6' stroke-width='2'%3E%3Cpath d='M1 3l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 7px center;font-weight:700;cursor:pointer}
  #out{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px}
  figure.panel{margin:0}
  .frame{background:#000;border:1px solid var(--border-sharp);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-card);transition:var(--t)}
  figure.panel:hover .frame{transform:translateY(-3px);border-color:var(--cyan);box-shadow:var(--shadow-hover)}
  .frame svg{display:block;width:100%;height:auto}
  figcaption{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:13px;color:var(--dim)}
  .pn{display:inline-grid;place-items:center;width:21px;height:21px;border-radius:5px;background:var(--pink);color:#000;font-size:12px;font-weight:700}

  /* Tabs: Builder / Script */
  .tabs{display:flex;gap:5px}
  .tab{font-family:var(--display);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
    padding:6px 13px;border:1px solid var(--border-soft);border-radius:6px;background:transparent;color:var(--dim);cursor:pointer;transition:var(--t)}
  .tab:hover{color:var(--cyan)}
  .tab.is-active{color:var(--cyan);border-color:var(--cyan);box-shadow:var(--glow-cyan)}

  /* Builder layout: rows on the left, the shared emote console on the right */
  .builder{display:grid;grid-template-columns:1fr 250px;gap:16px;align-items:start}

  /* The Comic-Chat "member list" — who is in the scene, each in their colour */
  .members{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:12px;
    padding:9px 11px;border:1px solid var(--border-soft);border-radius:var(--radius);background:var(--tile)}
  .members-cap{font-family:var(--display);font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-right:2px}
  .members-empty{font-family:var(--sans);font-size:13px;color:var(--dim)}
  .member{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;cursor:pointer;transition:var(--t);
    font:700 13px var(--sans);color:var(--text);background:rgba(0,0,0,.4);border:1px solid var(--c)}
  .member:hover{box-shadow:0 0 8px var(--c)}
  .member .sw{width:11px;height:11px;border-radius:50%;background:var(--c);flex:0 0 auto;box-shadow:0 0 6px var(--c)}
  .member .ct{font-family:var(--mono);font-size:11px;color:var(--c);opacity:.85}

  .rows{margin-bottom:9px}
  .brow{display:flex;gap:7px;align-items:center;padding:7px 8px;margin-bottom:7px;
    border:1px solid var(--border-soft);border-left:3px solid var(--c,var(--border-soft));border-radius:var(--radius);background:var(--tile);transition:border-color var(--t),box-shadow var(--t)}
  .brow:hover{border-color:var(--border-sharp)}
  .brow.is-active{border-color:var(--cyan);box-shadow:var(--glow-cyan)}
  .brow.dragging{opacity:.45}
  .brow .grip{color:var(--dim);cursor:grab;font-size:15px;line-height:1;flex:0 0 auto}
  .brow .rsw{width:9px;height:9px;border-radius:50%;background:var(--c,var(--dim));flex:0 0 auto;box-shadow:0 0 5px var(--c)}
  .brow select,.brow input{height:32px;font:13px var(--sans)}
  .brow .who{width:auto;max-width:130px;flex:0 0 auto}
  .brow .to,.brow .kind{width:auto;max-width:118px;flex:0 0 auto}
  .brow .line{flex:1 1 90px;min-width:80px;border:1px solid var(--border-sharp);border-radius:6px;background:#000;color:var(--text);padding:0 10px}
  .brow .badge{font-family:var(--display);font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--violet);
    border:1px solid var(--border-soft);border-radius:999px;padding:3px 9px;white-space:nowrap;flex:0 0 auto}
  .brow .rm{width:26px;height:26px;flex:0 0 auto;border:none;background:transparent;color:var(--dim);font-size:14px;line-height:1;cursor:pointer;border-radius:6px;padding:0}
  .brow .rm:hover{color:var(--pink);background:rgba(255,43,179,.12)}
  .add-row{width:100%;justify-content:center;border-style:dashed}

  /* The emote console: preview + wheel + gestures */
  .console{position:sticky;top:14px;display:flex;flex-direction:column}
  .console-cap{font-family:var(--display);font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--pink);margin:0 0 7px}
  .console-cap:not(:first-child){margin-top:15px}
  .preview{background:#fdfdf8;border:1px solid var(--border-sharp);border-radius:var(--radius);overflow:hidden;aspect-ratio:4/3;display:grid;place-items:center}
  .preview svg{width:100%;height:100%;display:block}
  .preview-empty{color:#888;font-size:12.5px;padding:16px;text-align:center;font-family:var(--sans)}
  .wheel{width:100%;max-width:250px;margin:0 auto;touch-action:none;-webkit-user-select:none;user-select:none}
  .wheel-svg{width:100%;height:auto;display:block;cursor:pointer}
  .wheel-svg.is-off{opacity:.4;pointer-events:none}
  .wheel-rim{fill:rgba(20,0,30,.55);stroke:var(--border-sharp);stroke-width:1.5}
  .wheel-spoke{stroke:var(--border-soft);stroke-width:1}
  .wheel-needle{stroke:var(--pink);stroke-width:2.5;stroke-linecap:round}
  .wheel-tip{fill:var(--pink)}
  .wheel-node{fill:#000;stroke:var(--border-sharp);stroke-width:1.5;transition:fill .12s}
  .wheel-node.is-on{fill:var(--cyan);stroke:var(--cyan)}
  .wheel-label{fill:var(--dim);font:700 10px var(--display);text-transform:uppercase;letter-spacing:.4px}
  .wheel-label.is-on{fill:var(--cyan)}
  .wheel-center{fill:#000;stroke:var(--border-sharp);stroke-width:1.5}
  .wheel-center.is-on{fill:var(--violet);stroke:var(--violet)}
  .wheel-clabel{fill:var(--dim);font:700 9px var(--display);text-transform:uppercase;letter-spacing:.4px;pointer-events:none}
  .wheel-clabel.is-on{fill:#fff}
  .gestures{display:flex;flex-wrap:wrap;gap:6px}
  .gest{font-family:var(--display);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
    padding:6px 9px;border-radius:6px;border:1px solid var(--border-sharp);background:#000;color:var(--dim);cursor:pointer;transition:var(--t)}
  .gest:hover{border-color:var(--cyan);color:var(--cyan)}
  .gest.is-on{background:var(--cyan);color:#000;border-color:var(--cyan)}
  .gest:disabled{opacity:.4;cursor:default}

  .site-foot{margin-top:52px;padding-top:22px;border-top:1px solid var(--border-soft);max-width:820px;color:var(--dim);font-size:13px;line-height:1.75}
  .site-foot p{margin:0 0 8px}
  .site-foot strong{color:var(--text);font-family:var(--display);letter-spacing:.5px}
  .site-foot a{color:var(--cyan);text-decoration:none}
  .site-foot a:hover{text-shadow:var(--glow-cyan)}
  .foot-links{margin-top:12px;font-family:var(--display);text-transform:uppercase;letter-spacing:1px;font-size:11.5px}

  @media (max-width:820px){.workspace{grid-template-columns:1fr}}
  @media (max-width:680px){.builder{grid-template-columns:1fr}.console{position:static}}
</style>

<div class="wrap">
  <header class="top">
    <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-4 4v-4H4z"/></svg></div>
    <div class="brand"><h1>Comic Chat Composer</h1><p>Turn a chat log into a comic strip &mdash; live.</p></div>
  </header>

  <div class="workspace">
    <div class="card">
      <div class="hd">
        <div class="tabs" role="tablist">
          <button id="tab-builder" class="tab is-active" role="tab">Builder</button>
          <button id="tab-script" class="tab" role="tab">Script</button>
        </div>
        <button id="example" class="linkbtn">Surprise me &#127922;</button>
      </div>
      <div class="bd">
        <div id="builder-pane">
          <div class="builder">
            <div class="builder-rows">
              <div id="members" class="members"></div>
              <div id="rows" class="rows"></div>
              <button id="add-row" class="btn add-row">&#43; Add line</button>
            </div>
            <div class="console">
              <div class="console-cap">Preview</div>
              <div id="preview" class="preview"></div>
              <div class="console-cap">Emotion</div>
              <div id="wheel" class="wheel"></div>
              <div class="console-cap">Gesture</div>
              <div id="gestures" class="gestures"></div>
            </div>
          </div>
        </div>
        <div id="script-pane" hidden>
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
    </div>

    <div class="card"><div class="bd">
      <div class="setting"><label>Scene</label><select id="scene">${sceneOptions}</select></div>
      <div class="setting"><label>Seed &mdash; each one is a new chat</label>
        <div class="seedrow"><input id="seed" type="number" value="1234">
          <button id="reseed" class="btn icon" title="Surprise me &mdash; new chat, cast &amp; scene" aria-label="Surprise me with a new chat">&#127922;</button>
        </div>
      </div>
      <label class="toggle"><input id="debug" type="checkbox"> Show layout guides</label>
      <div class="divider"></div>
      <div class="setting"><label>Save strip &mdash; columns</label><input id="cols" type="number" min="1" max="8" value="3"></div>
      <div class="exports"><button id="dl-png" class="btn primary">Download PNG</button><button id="dl-svg" class="btn">SVG</button></div>
    </div></div>
  </div>

  <div class="section-label" id="cast-label">Cast</div>
  <div id="cast"></div>
  <div class="section-label">Comic <span id="status"></span></div>
  <div id="out"></div>

  <footer class="site-foot">
    <p><strong>Comic Chat Composer</strong> &mdash; an independent, open-source reimplementation of the
    <a href="https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf" target="_blank" rel="noopener">Microsoft Comic Chat</a>
    panel-composition algorithm (Kurlander, Skelly &amp; Salesin, SIGGRAPH&nbsp;&rsquo;96). Built by Onion Madder.</p>
    <p>Not affiliated with, sponsored by, or endorsed by Microsoft. The bundled Comic Chat character and
    backdrop art is Microsoft&rsquo;s own, MIT-licensed and redistributed with attribution.</p>
    <p class="foot-links"><a href="${REPO_URL}" target="_blank" rel="noopener">Source &amp; credits on GitHub</a> &middot; MIT License</p>
  </footer>
</div>

<script>${js}</script>
</html>
`;

const outPath = join(here, 'index.html');
writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
