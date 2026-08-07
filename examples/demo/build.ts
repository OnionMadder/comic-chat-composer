/**
 * Builds the demo into three co-located files in `examples/demo/`:
 *
 *   - `index.html` — the page shell (generated here: meta, markup, scene/hint
 *     options), linking the stylesheet and the app module.
 *   - `app.js`     — the composer, renderer and every sprite, bundled by esbuild
 *     as an ES module. The sprite/backdrop/manifest data is inlined via `define`.
 *   - `style.css`  — hand-edited source (not generated); the font is a sibling
 *     file under `assets/`.
 *
 * The page loads only these co-located files — no third-party or network
 * requests — but, being ES modules, it must be served over http(s) (Neocities,
 * onionmadder.com, or the local dev server), not opened from `file://`.
 *
 * Run with:  npm run demo   (and `npm run deploy:stage` to copy the set out)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { loadCharacters, loadBackdrops } from '../load-assets.ts';
import { HINT_WORDS } from '../parse-log.ts';
import { generateConversation } from '../generate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'assets', 'comic-chat');

// Every bundled Comic Chat character (manifest + sprite markup) and backdrop.
// These are inlined into app.js via esbuild `define`, so the page needs no
// asset fetches beyond its own three files (+ the font).
const loaded = loadCharacters(join(root, 'characters'));
const manifests: Record<string, unknown> = {};
const sprites: Record<string, Record<string, string>> = {};
for (const [cid, { manifest, sprites: s }] of Object.entries(loaded)) {
  manifests[cid] = manifest;
  sprites[cid] = s;
}
const backdrops = loadBackdrops(join(root, 'backdrops'));

console.log(`inlining ${Object.keys(manifests).length} characters, ${Object.keys(backdrops).length} backdrops`);

const appPath = join(here, 'app.js');
await esbuild.build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: appPath,
  define: {
    __MANIFESTS__: JSON.stringify(manifests),
    __SPRITES__: JSON.stringify(sprites),
    __BACKDROPS__: JSON.stringify(backdrops),
  },
});

// The initial <textarea> matches the conversation the app generates for seed
// 1234, so there's no swap-flash on load.
const DEFAULT_SEED = 1234;
const DEFAULT_LOG = generateConversation(DEFAULT_SEED);

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
// Drive the footer links and the canonical / Open Graph meta.
const SITE_URL = 'https://onionmadder.com/comic-chat-composer/';
const REPO_URL = 'https://github.com/OnionMadder/comic-chat-composer';
// Social card image. Set to '' to fall back to a text-only `summary` card.
const SOCIAL_IMAGE = 'https://onionmadder.com/assets/img/socials.jpg';
const PAGE_DESC =
  'Turn a chat log into a comic strip — an independent, open-source ' +
  "reimplementation of Microsoft Comic Chat's panel-composition algorithm " +
  '(Kurlander, Skelly and Salesin, SIGGRAPH ’96). Not affiliated with Microsoft.';

/**
 * Deployment-specific `<head>` content, injected verbatim if the file exists.
 *
 * This exists because the live onionmadder.com `index.html` had been *hand
 * patched* on the server with analytics and a schema.org graph that this script
 * did not produce — so every deploy of the generated file silently deleted them,
 * and the page still worked, so nothing announced the loss. Generating it is the
 * fix; the alternative was a warning in CLAUDE.md telling a human to remember.
 *
 * It is a separate file rather than a constant here because its contents are
 * **not** the project's — they are one particular site's analytics and one
 * particular person's identity graph. A fork that deploys the demo should
 * delete or replace `head-extra.html`, and nothing else needs touching.
 */
const headExtra = (() => {
  const path = join(here, 'head-extra.html');
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').trim();
})();

// A speech-bubble favicon as an inline data URI (kept inline — it's tiny).
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
<meta name="robots" content="index, follow">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="Comic Chat Composer">
<meta property="og:description" content="${PAGE_DESC}">
<meta property="og:url" content="${SITE_URL}">${SOCIAL_IMAGE ? `
<meta property="og:image" content="${SOCIAL_IMAGE}">` : ''}
<meta name="twitter:card" content="${SOCIAL_IMAGE ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="Comic Chat Composer">
<meta name="twitter:description" content="${PAGE_DESC}">${SOCIAL_IMAGE ? `
<meta name="twitter:image" content="${SOCIAL_IMAGE}">` : ''}${headExtra ? `
${headExtra}` : ''}
<link rel="stylesheet" href="style.css">

<div class="wrap">
  <header class="top">
    <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-4 4v-4H4z"/></svg></div>
    <div class="brand"><h1>Comic Chat Composer</h1><p>Turn a chat log into a comic strip &mdash; live.</p></div>
  </header>

  <div class="col-left">
  <div class="workspace">
    <div class="card">
      <div class="hd">
        <div class="tabs" role="tablist">
          <button id="tab-builder" class="tab is-active" role="tab" aria-selected="true">Builder</button>
          <button id="tab-script" class="tab" role="tab" aria-selected="false">Script</button>
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
              <p style="margin:9px 0 0"><code>bob (angry):</code> with no text &mdash; a wordless reaction, posed in the panel they're reacting to. A <b>blank line</b> ends the panel.</p>
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
      <div class="setting"><label>Title &mdash; shown on exports</label><input id="title" type="text" maxlength="80" placeholder="Name your comic"></div>
      <div class="setting"><label>Subtitle &mdash; optional byline</label><input id="subtitle" type="text" maxlength="100" placeholder="by you"></div>
      <div class="setting"><label>Save strip &mdash; columns</label><input id="cols" type="number" min="1" max="8" value="3"></div>
      <label class="toggle"><input id="credits" type="checkbox"> Add a &ldquo;starring&rdquo; cast panel</label>
      <div class="exports"><button id="dl-png" class="btn primary">Download PNG</button><button id="dl-svg" class="btn">SVG</button></div>
      <button id="share" class="btn share-btn">&#128279; Copy share link</button>
    </div></div>
  </div>

  <div class="section-label" id="cast-label">Cast</div>
  <div id="cast"></div>
  </div>

  <div class="col-right">
  <div class="section-label">Comic <span id="status"></span></div>
  <div id="comic-title" class="comic-title" hidden></div>
  <div id="out"></div>
  </div>

  <footer class="site-foot">
    <p><strong>Comic Chat Composer</strong> &mdash; an independent, open-source reimplementation of the
    <a href="https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf" target="_blank" rel="noopener">Microsoft Comic Chat</a>
    panel-composition algorithm (Kurlander, Skelly &amp; Salesin, SIGGRAPH&nbsp;&rsquo;96). Built by Onion Madder.</p>
    <p>Not affiliated with, sponsored by, or endorsed by Microsoft. The bundled Comic Chat character and
    backdrop art is Microsoft&rsquo;s own, MIT-licensed and redistributed with attribution.</p>
    <p class="foot-links"><a href="${REPO_URL}" target="_blank" rel="noopener">Source &amp; credits on GitHub</a> &middot; MIT License</p>
  </footer>
</div>

<script type="module" src="app.js"></script>
</html>
`;

const outPath = join(here, 'index.html');
writeFileSync(outPath, html, 'utf8');
console.log(
  `wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB) + app.js + style.css — served as a set, no network requests`,
);
// Say so either way. Silence is how the hand-patched head went missing in the
// first place: a deploy that quietly drops the analytics and schema.org block
// produces a page that looks perfectly fine.
console.log(
  headExtra
    ? `injected head-extra.html (${headExtra.length} bytes of deployment-specific <head>)`
    : 'no head-extra.html — building a clean page with no analytics or schema.org',
);
