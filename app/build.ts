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
  },
});

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

const opt = (v: string, label: string): string => `<option value="${v}">${label}</option>`;
const emotions = ['neutral', 'happy', 'laughing', 'coy', 'sad', 'angry', 'shouting', 'scared', 'bored'];
const gestures = ['neutral', 'wave', 'point-self', 'point-other', 'smile', 'shrug'];
const kinds: Array<[string, string]> = [
  ['say', 'say'], ['think', 'think'], ['whisper', 'whisper'], ['shout', 'shout'], ['action', 'action'],
];

const balloonIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-4 4v-4H4z"/></svg>`;

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
    <span class="spacer"></span>
    <button id="undo" class="iconbtn" aria-label="Undo last line" title="Undo">&#8630;</button>
    <button id="dice" class="iconbtn" aria-label="Surprise me" title="Surprise me">&#127922;</button>
    <button id="export" class="iconbtn" aria-label="Export" title="Export (coming soon)" disabled>&#8681;</button>
  </header>

  <main id="comic" class="comic" aria-label="Your comic"></main>

  <footer class="composer">
    <div id="cast" class="cast"></div>
    <div class="speaking" id="speaking"></div>
    <div class="inputrow">
      <button id="more" class="iconbtn round" aria-label="More options">+</button>
      <input id="text" class="text" type="text" autocomplete="off" autocapitalize="sentences"
             placeholder="Type a line&hellip;" aria-label="Line text">
      <button id="send" class="send" aria-label="Send">${balloonIcon}</button>
    </div>
    <div id="tray" class="tray">
      <label>delivery<select id="kind">${kinds.map(([v, l]) => opt(v, l)).join('')}</select></label>
      <label>emotion<select id="emotion">${emotions.map((e) => opt(e, e)).join('')}</select></label>
      <label>gesture<select id="gesture">${gestures.map((g) => opt(g, g)).join('')}</select></label>
      <label>to<select id="addressee"><option value="">to everyone</option></select></label>
    </div>
  </footer>
</div>

<div id="sheet" class="sheet" role="dialog" aria-label="Add a character">
  <div class="sheet-panel">
    <div class="sheet-head"><span>Add a character</span><button id="sheet-close" class="iconbtn" aria-label="Close">&times;</button></div>
    <div id="sheet-body" class="sheet-body"></div>
  </div>
</div>

<script type="module" src="app.js"></script>
</body>
</html>
`;

writeFileSync(join(www, 'index.html'), html, 'utf8');
console.log(`wrote www/index.html + app.js + style.css — offline app bundle`);
