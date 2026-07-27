# comic-chat-composer

An independent, MIT-licensed TypeScript reimplementation of the **Microsoft
Comic Chat** panel-composition algorithm, from Kurlander, Skelly & Salesin's
SIGGRAPH '96 paper *"Comic Chat"*. Give it a chat log and a cast; it returns an
ordered array of **panel layout trees** — pure geometry and identity, no pixels.
Rendering is a separate concern (a reference SVG renderer lives in `examples/`).

Owner: **Onion Madder** (Kellye Strickland). Not affiliated with Microsoft.

> **Status:** local git only. **Do not `npm publish` or add a git remote without
> being asked** — publishing is deliberately deferred. The name
> `comic-chat-composer` is confirmed free on npm.

## Commands

```bash
npm test          # node --test over test/*.test.ts (strip-types; no build step)
npm run typecheck # tsc --noEmit
npm run build     # tsc -> dist/ (the publishable library; ESM, zero runtime deps)
npm run example   # examples/basic-chat.ts — prints a composed layout tree
npm run demo      # build the demo set: examples/demo/{index.html,app.js} (+ style.css)
npm run deploy:stage  # npm run demo, then copy the set to the local staging dir
```

- **Node 22+, ESM, TypeScript strict.** Tests run directly off `.ts` via
  `--experimental-strip-types` — no compile before test.
- The published library is **`src/` only** and has **zero runtime dependencies**.
  Everything in `examples/` (renderer, demo, corpus, parsers) is not part of the
  package surface — it's reference code, and may use dev deps (esbuild).

## Architecture

**The library — `src/`** (pixel-free; emits a layout tree):
- `compose.ts` — the orchestrator. Event stream → `Panel[]`. Owns gesture/
  expression inference dispatch, balloon-kind selection (incl. auto-shout for
  yelled lines), character-inclusion + panel-break rules, the solo-panel roll,
  establishing-shot policy (`rules.establishingShots`: `fold` default / `per-join`
  / `off`), one-scene-per-conversation backdrop choice, and assembling each panel.
- `placement.ts` — §4.3 greedy character placement + the Facing/Neighbors
  scoring function (who stands where, facing whom).
- `balloons.ts` — §5.2 routing-channel balloon layout (`PlaceBalloons`,
  `maxAllowable`, `reduceChannel`, `squeezeBalloon`), vertical placement,
  reading order, tails, and oversized-text splitting.
- `camera.ts` — §6.2 virtual camera. Head-anchored framing; crops at shoulders/
  knees/full body, never the neck or ankles; pulls back for establishing shots.
- `pose.ts` — §4.1 gesture/expression inference (emoticons, LOL/IMHO/BRB, ALL-
  CAPS/!!! shouting, greetings, self/other references, neutral cycling).
- `manifest.ts` — character asset schema + validation. Two kinds: **layered**
  (heads-by-emotion × bodies-by-gesture) and **figure** (whole-figure single
  sprites keyed by pose). Helpers: `headForExpression`, `bodyForGesture`,
  `figureFor`, `isFigureManifest`, `isExpressive`, `characterProportions`.
- `rng.ts` — seeded mulberry32 (`createRandom`) + `seededIndex` (fmix32) for
  well-distributed one-shot seed picks (scene, corpus selection).
- `text.ts` — font-metric approximation + word wrapping.
- `types.ts` — `ChatEvent`, `Panel`, `Rules`, `Camera`, etc. `index.ts` is the
  public export barrel.

**Reference code — `examples/`** (not shipped in the package):
- `render-svg.ts` — SVG renderer: §5.3 balloon splines (via `balloon-shape.ts`),
  §6.1 halos (feMorphology aura), backdrops, the camera transform.
- `parse-log.ts` — plain-text log → events, incl. the `name (hint): text` per-
  line directions. `HINT_WORDS` drives the demo's help text.
- `corpus.ts` — 47 hand-written conversations (incl. 3–4-person group chats).
- `generate.ts` — procedural conversation generator: mad-libs templates ×
  name/filler pools, deterministic per seed (`generateConversation`). The demo's
  seed roll uses this (with the curated corpus surfacing ~1 in 4), so seeds are
  near-always unique instead of cycling a finite list.
- `strip.ts` — tiles panels into one downloadable strip SVG.
- `load-assets.ts` — loads manifests + inlines sprite/backdrop markup.
- `demo/` — the web demo. `build.ts` bundles `main.ts` → `app.js` (ESM, sprites
  inlined via esbuild `define`) and generates `index.html`; `style.css` is a
  hand-edited source file; `stage.ts` copies the set to the staging dir. Loads
  only its own files but needs http(s) (ESM). `main.ts` is the browser entry.

**Assets — `assets/comic-chat/`**: all **22** real Comic Chat v1.0 characters
and **9** v2.5 backdrops (`NOTICE.md` has attribution — MS art is MIT).

**Tools — `tools/`** (one-time asset generation, Python + Pillow/numpy):
- `import-avb.py` — decodes `.avb` avatars → PNG sprites + JSON manifests.
- `import-bgb.py` — decodes `.bgb` backdrops (zlib + 4/8-bit indexed) → PNG.
- Regenerate: sparse-clone `microsoft/comic-chat`, point the tools at
  `v1.0/client/comicart/avatars` and `v2.5-beta-1/{comicart,artpack1}`.

## Conventions

- **Faithful to the paper first.** Where the paper and the original C++ diverge,
  document the choice in `docs/ALGORITHM.md` (which tracks every divergence).
- **Determinism.** Same events + cast + seed → identical panels. The
  golden-master test (`test/golden.test.ts`, fixture in `test/golden/`) locks
  the whole pipeline; regenerate intentional changes with `UPDATE_GOLDEN=1 npm
  test`.
- **The composer never touches pixels.** Anchors/geometry only; renderers own
  drawing. Keep it that way.
- **Demo is a self-contained *set* of co-located files** — `index.html`
  (generated shell), `app.js` (ESM bundle with all sprites/backdrops inlined via
  esbuild `define`), `style.css` (hand-edited source), and the font under
  `assets/`. **No third-party or network requests** — it loads only its own
  files. Because `app.js` is an ES module, the page must be **served over
  http(s)** (Neocities, onionmadder, the dev server) — it will not run from
  `file://`. `style.css` is the source of truth for styling — edit it directly,
  not `build.ts`. The public-site URLs live in `SITE_URL`/`REPO_URL` in
  `demo/build.ts`.

## Deploying the demo (NearlyFreeSpeech.NET via WinSCP)

The site lives at <https://onionmadder.com/comic-chat-composer/>. `npm run
deploy:stage` builds and copies the whole set (`index.html`, `app.js`,
`style.css`, `assets/ChakraPetch-Regular.ttf`) into the local staging folder
(`.stage-dir`, gitignored). Then upload that set via WinSCP to
`/home/public/comic-chat-composer/` — **all four files**, preserving the
`assets/` subfolder — **confirm overwrites**, and hard-refresh (Ctrl+Shift+R).
Files need 644 / dirs 755 if a 403 appears. The public URL is baked into
`canonical`/Open Graph meta via `SITE_URL` in `demo/build.ts`.

## What's built (the arc so far)

Routing-channel balloon layout → §5.3 splined balloons → §6.2 head-anchored
camera → §6.1 halos → the full 22-character cast (incl. whole-figure avatars)
and 9 backdrops decoded from the original binaries → per-line hint directions →
cast control → one-room-per-conversation with an even scene spread → a
golden-master safety net (which caught and fixed a dropped-message bug) →
cross-checked `maxAllowable` against the C++ (a real min→max fix) → a redesigned
demo → the Onion neon "onionized" house style → a conversation corpus the seed
selects from → a low-vision readability pass → the **form-based conversation
builder** (row editor + the tactile emotion wheel + live character preview +
gesture buttons, Builder/Script tabs) → color-coded cast with a Comic-Chat
"in scene" member list → the corpus grew to 47 conversations (incl. a batch of
3–4-person group chats).

## The conversation builder — built, and what's left

The Comic-Chat-style form builder now leads the demo (Builder tab default; the
text-script textarea lives under a Script tab for power users / paste). It's all
`examples/demo/` — `builder.ts` owns the UI and hands the host
`{ events, authors, cast }`; `main.ts` calls the same `compose` +
`renderPanelToSvg` path either way. The chosen character *is* the speaker
identity, so the cast map is built directly (no `parseLog` round-trip needed to
compose; `builder.toScript()` still emits `name (hint): text` for the Script tab).

**Done:**
1. **Row-based builder** — character dropdown, text field, "to →" addressee, and
   a delivery select (say / whisper / think / shout / action; shout draws the
   §5.1 jagged starburst balloon). Add / remove /
   drag-to-reorder. Each row shows a live emotion·gesture badge. Chat-like
   authoring: Enter starts the next line (picking the reply/alternating speaker
   and focusing it), Backspace on an empty line deletes it and jumps back.
2. **The emotion wheel** — 8 emotions on the perimeter (happy, laughing, coy,
   shouting, angry, sad, scared, bored), neutral at center, intensity = radius,
   click/drag. Maps to `expressionOverride`; `intensity` is captured on the row
   but not yet consumed (see below).
3. **Live character preview** — the selected character reacting in the chosen
   look, via a synthetic one-character identity-camera panel through
   `renderPanelToSvg` (same sprite/halo resolution as a real panel).
4. **Gesture buttons** (neutral / wave / point-self / point-other / smile /
   shrug) → `gestureOverride`.
5. **Comic-Chat member list + color-coded cast** — an "in scene" strip of the
   distinct speakers, each in a stable neon color (pink/cyan/violet/amber/lime/
   blue, from `colorOf` in `main.ts`); the same color tints the row accents, the
   preview border, and the Script-tab cast chips. Clicking a member selects
   their first line.
6. **Shareable permalinks** — the "Copy share link" button packs the script,
   seed, and scene into the URL hash (`#c=<base64url JSON>`); opening the link
   (fresh load or a pasted hash) reproduces the comic exactly. Fidelity relies
   on `resolveCast` treating a participant whose name *is* a character id as
   that character — so a Builder-authored comic (author = characterId) keeps its
   exact cast through `toScript()` → link → `parseLog`. Marks the comic
   `authored`, so the seed won't overwrite a shared script.

**Still open:**
- **Deeper Comic-Chat window chrome** — the member list is the big piece; the
  framing could go further if wanted (without copying Win95 literally).
- **Intensity plumbing** — thread the wheel's `intensity` (already on each row)
  from `expressionOverride` into inference/rendering. This is the one item that
  needs `src/` changes (`pose.ts`/inference + the manifest), and has little
  visible payoff until the asset set has per-intensity sprites — deferred.
- Seeds now procedurally generate (`generate.ts`) — ~792 distinct comics per
  1000 seeds — so repeats are rare. Add templates/pools to widen further.
