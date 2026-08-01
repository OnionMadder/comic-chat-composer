/**
 * Build the mComic '96 web app into `www/` — the directory Capacitor copies
 * into the Android APK. Produces:
 *
 *   - `www/index.html` — the mobile app shell (generated here)
 *   - `www/app.js`     — the composer, renderer, and every sprite/backdrop,
 *     bundled by esbuild as an ES module (assets inlined via `define`)
 *   - `www/style.css`  — copied from the hand-edited `style.css` source
 *
 * All assets are inlined into the bundle, so the WebView makes no network
 * requests — the app runs fully offline.
 *
 *   node --experimental-strip-types build.ts   (then: npx cap sync)
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { loadCharacters, loadBackdrops } from '../examples/load-assets.ts';
import { BRAND } from './branding.ts';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets', 'comic-chat');
const www = join(here, 'www');
mkdirSync(www, { recursive: true });

const loaded = loadCharacters(join(assets, 'characters'));
const manifests: Record<string, unknown> = {};
const sprites: Record<string, Record<string, string>> = {};
for (const [cid, { manifest, sprites: s }] of Object.entries(loaded)) {
  manifests[cid] = manifest;
  sprites[cid] = s;
}
const backdrops = loadBackdrops(join(assets, 'backdrops'));
console.log(`inlining ${Object.keys(manifests).length} characters, ${Object.keys(backdrops).length} backdrops`);

// Inline Comic Neue (OFL) as data URIs, prepended to the stylesheet. Android
// ships no comic font and the composer sizes balloons against one, so shipping
// a known face is what keeps balloon text inside its balloon. Inlining (rather
// than a separate file) means the font is present the instant the CSS parses —
// no fetch, no load-timing gap where a wider fallback would render and clip.
const fontDir = join(here, 'node_modules', '@fontsource', 'comic-neue', 'files');
const face = (weight: number, file: string): string => {
  const b64 = readFileSync(join(fontDir, file)).toString('base64');
  return (
    `@font-face{font-family:'Comic Neue';font-style:normal;font-weight:${weight};` +
    `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`
  );
};
const fonts =
  face(400, 'comic-neue-latin-400-normal.woff2') + '\n' +
  face(700, 'comic-neue-latin-700-normal.woff2') + '\n';
writeFileSync(join(www, 'style.css'), fonts + readFileSync(join(here, 'style.css'), 'utf8'));

// The same font CSS goes into the bundle as well, because export rasterises the
// strip SVG through an <img>. That SVG is an isolated document — it cannot see
// this page's @font-face, so without its own copy the balloon text falls back
// to a wide serif and clips (the exact failure headless Chrome shows). Costs a
// duplicated ~50KB of base64; correctness of the thing users actually keep.
await esbuild.build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: join(www, 'app.js'),
  define: {
    __MANIFESTS__: JSON.stringify(manifests),
    __SPRITES__: JSON.stringify(sprites),
    __BACKDROPS__: JSON.stringify(backdrops),
    __FONT_CSS__: JSON.stringify(fonts),
  },
});

// The chip strips populate on load from these lists via renderer functions in
// main.ts; keep the ids stable so the wire-up stays trivial.

const balloonIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-4 4v-4H4z"/></svg>`;

// A visible build stamp so we can confirm a device actually has the latest
// bundle — genuinely useful while sideloading, and noise in a shipped app.
// `--release` drops it (see the `build:release` script); a plain build keeps it.
const RELEASE = process.argv.includes('--release');
const BUILD = new Date().toLocaleTimeString('en-US', { hour12: false });
const buildStamp = RELEASE ? '' : `<span class="build" aria-hidden="true">b${BUILD}</span>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#08080b">
<title>${BRAND.name}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="app">
  <header class="appbar">
    <span class="wordmark"><span class="m">m</span><span class="c">Comic</span><span class="yr">'96</span></span>
    ${buildStamp}
    <span class="spacer"></span>
    <button id="library" class="iconbtn" aria-label="Your comics" title="Your comics">&#128218;</button>
    <button id="undo" class="iconbtn" aria-label="Undo last line" title="Undo">&#8630;</button>
    <button id="dice" class="iconbtn" aria-label="Surprise me" title="Surprise me">&#127922;</button>
    <button id="export" class="iconbtn" aria-label="Export your comic" title="Export">&#8681;</button>
    <button id="help" class="iconbtn" aria-label="How it works" title="How it works">?</button>
  </header>

  <main id="comic" class="comic" aria-label="Your comic"></main>

  <footer class="composer">
    <div id="cast" class="cast"></div>
    <div class="speaking" id="speaking"></div>
    <div id="edit-bar" class="edit-bar" role="region" aria-label="Editing panel">
      <span id="edit-label" class="edit-label">Editing</span>
      <label class="edit-speaker-wrap" aria-label="Panel speaker">
        <span class="lbl">speaker</span>
        <select id="edit-speaker" class="edit-speaker"></select>
      </label>
      <div class="edit-actions">
        <button id="edit-ins-before" class="iconbtn" aria-label="Insert a blank panel before this one" title="Insert before">&#43;&#8593;</button>
        <button id="edit-ins-after" class="iconbtn" aria-label="Insert a blank panel after this one" title="Insert after">&#43;&#8595;</button>
        <button id="edit-dup" class="iconbtn" aria-label="Duplicate this panel" title="Duplicate">&#10697;</button>
        <button id="edit-delete" class="iconbtn del" aria-label="Delete panel" title="Delete panel">&#128465;</button>
        <button id="edit-cancel" class="iconbtn" aria-label="Cancel edit" title="Cancel">&times;</button>
      </div>
      <label class="panelrow" id="lines-row">
        <span class="lbl">lines</span>
        <div id="line-chips" class="panel-cast" role="group" aria-label="Lines in this panel"></div>
      </label>
      <label class="panelrow">
        <span class="lbl">in this panel</span>
        <div id="panel-cast" class="panel-cast" role="group" aria-label="Characters in this panel"></div>
      </label>
      <label class="panelrow" id="arrange-row">
        <span class="lbl">arrange</span>
        <div id="in-scene" class="in-scene" role="toolbar" aria-label="Arrange characters"></div>
      </label>
    </div>
    <div class="inputrow">
      <button id="more" class="iconbtn round" aria-label="More options">+</button>
      <input id="text" class="text" type="text" autocomplete="off" autocapitalize="sentences"
             placeholder="Type a line&hellip;" aria-label="Line text">
      <button id="send" class="send" aria-label="Send">${balloonIcon}</button>
    </div>
    <div id="tray" class="tray">
      <div class="console">
        <div id="preview" class="preview" aria-label="Speaker preview"></div>
        <div id="wheel" class="wheel"></div>
      </div>
      <label class="pickrow">
        <span class="lbl">delivery</span>
        <div id="kind-chips" class="pickchips" role="radiogroup" aria-label="Delivery"></div>
      </label>
      <label class="pickrow">
        <span class="lbl">gesture</span>
        <div id="gesture-chips" class="pickchips" role="radiogroup" aria-label="Gesture"></div>
      </label>
      <label class="addressees-row" id="addressees-row">
        <span class="lbl">also in panel</span>
        <div id="addressees" class="addressees"></div>
      </label>
    </div>
  </footer>
</div>

<div id="sheet" class="sheet" role="dialog" aria-label="Add a character">
  <div class="sheet-panel">
    <div class="sheet-head"><span>Add a character</span><button id="sheet-close" class="iconbtn" aria-label="Close">&times;</button></div>
    <div id="sheet-body" class="sheet-body"></div>
  </div>
</div>

<div id="library-sheet" class="sheet" role="dialog" aria-label="Your comics">
  <div class="sheet-panel">
    <div class="sheet-head">
      <span>Your comics</span>
      <button id="library-close" class="iconbtn" aria-label="Close">&times;</button>
    </div>
    <button id="library-new" class="newcomic">+ New comic</button>
    <div id="library-list" class="library-list"></div>
  </div>
</div>

<div id="intro" class="sheet" role="dialog" aria-label="How mComic '96 works">
  <div class="sheet-panel">
    <div class="sheet-head"><span>How it works</span></div>
    <ul class="intro-list">
      <li><span class="intro-key" aria-hidden="true">${balloonIcon}</span>
        <span><b>Type a line and send.</b> Pick who&rsquo;s talking from the row of names, and your conversation draws itself into a comic.</span></li>
      <li><span class="intro-key" aria-hidden="true">&#9995;</span>
        <span><b>Tap a panel to rewrite it.</b> Change the words, the speaker, the mood &mdash; or add someone else to the frame.</span></li>
      <li><span class="intro-key" aria-hidden="true">&#8597;</span>
        <span><b>Press and hold a panel to move it.</b> Drag it up or down to re-order the story.</span></li>
      <li><span class="intro-key" aria-hidden="true">&#9673;</span>
        <span><b>Drag the wheel for a mood.</b> Angle picks the feeling, distance from the middle picks how strongly.</span></li>
      <li><span class="intro-key" aria-hidden="true">&#127922;</span>
        <span><b>Stuck?</b> The dice writes you a fresh comic. &#128218; keeps your drafts, &#8681; saves a picture to share.</span></li>
    </ul>
    <div class="confirm-actions">
      <button id="intro-go" class="confirm-btn go">Start drawing</button>
    </div>
  </div>
</div>

<div id="confirm" class="sheet" role="dialog" aria-label="Confirm">
  <div class="sheet-panel">
    <div class="sheet-head"><span id="confirm-title">Are you sure?</span></div>
    <p id="confirm-copy" class="confirm-copy"></p>
    <div class="confirm-actions">
      <button id="confirm-cancel" class="confirm-btn keep">Cancel</button>
      <button id="confirm-go" class="confirm-btn go">Continue</button>
    </div>
  </div>
</div>

<div id="export-sheet" class="sheet" role="dialog" aria-label="Export your comic">
  <div class="sheet-panel">
    <div class="sheet-head"><span>Export your comic</span><button id="export-close" class="iconbtn" aria-label="Close">&times;</button></div>
    <div class="export-body">
      <label class="exp-field">
        <span class="lbl">title</span>
        <input id="exp-title" class="text" type="text" maxlength="80" autocomplete="off"
               placeholder="Untitled" aria-label="Comic title">
      </label>
      <label class="exp-field">
        <span class="lbl">subtitle</span>
        <input id="exp-subtitle" class="text" type="text" maxlength="100" autocomplete="off"
               placeholder="optional" aria-label="Comic subtitle">
      </label>
      <div class="exp-field">
        <span class="lbl">columns</span>
        <div id="exp-columns" class="pickchips" role="radiogroup" aria-label="Panels per row"></div>
      </div>
      <label class="exp-toggle">
        <input id="exp-credits" type="checkbox">
        <span>Add a &ldquo;starring&rdquo; cast panel</span>
      </label>
      <div id="exp-status" class="exp-status" role="status"></div>
      <button id="exp-go" class="exp-go">Download</button>
    </div>
  </div>
</div>

<script type="module" src="app.js?v=${Date.now()}"></script>
</body>
</html>
`;

writeFileSync(join(www, 'index.html'), html, 'utf8');
console.log(`wrote www/index.html + app.js + style.css — offline app bundle`);
