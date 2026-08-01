# comic-chat-composer

An independent, MIT-licensed TypeScript reimplementation of the **Microsoft
Comic Chat** panel-composition algorithm, from Kurlander, Skelly & Salesin's
SIGGRAPH '96 paper *"Comic Chat"*. Give it a chat log and a cast; it returns an
ordered array of **panel layout trees** — pure geometry and identity, no pixels.
Rendering is a separate concern (a reference SVG renderer lives in `examples/`).

Owner: **Onion Madder** (Kellye Strickland). Not affiliated with Microsoft.

> **Status:** public on GitHub — <https://github.com/OnionMadder/comic-chat-composer>
> (default branch `main`). **Not on npm**, deliberately — **don't `npm publish`
> without being asked** (the name is confirmed free). Git workflow: branch off
> `main`, then merge back and `git push origin main`. The demo is live at both
> mirrors (see Deploying, below).
>
> **Two products are built on this library.** **mComic '96** (the mobile app)
> lives on the `mcomic96-app` branch. **Comic Court** (a webcomic) was extracted
> into its own repo at `projects/comic-court` once the two started diverging —
> it depends on this package and vendors the `examples/` render pipeline, which
> is the layer a strip keeps bending. Neither product should import from the
> other, and library fixes flow outward from here.

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
  yelled lines), character-inclusion + panel-break rules, **wordless reactions**
  (`{type:'reaction'}` — a pose with no balloon; someone already in frame is
  re-posed *in place* rather than breaking, as the shipped client's
  `ReplaceBody` did) and **explicit breaks** (`{type:'break'}`, the client's
  `<Brk>`; the log parser emits one for a blank line), the solo-panel roll,
  establishing-shot policy (`rules.establishingShots`: `fold` default / `per-join`
  / `off`), one-scene-per-conversation backdrop choice, and assembling each panel.
- `placement.ts` — §4.3 greedy character placement + the Facing/Neighbors
  scoring function (who stands where, facing whom).
- `balloons.ts` — §5.2 routing-channel balloon layout (`PlaceBalloons`,
  `maxAllowable`, `reduceChannel`, `squeezeBalloon`), vertical placement,
  reading order, tails, and oversized-text splitting.
- `camera.ts` — §6.2 virtual camera. Head-anchored framing; crops at shoulders/
  knees/full body, never the neck or ankles; pulls back for establishing shots.
- `pose.ts` — §4.1 gesture/expression inference, as a **data-driven rule
  table** the way the original was (its rules lived in localizable `chat.rc`
  string resources). Each rule is matcher (`all-caps`/`find`/`word`/`start`) ×
  cue × **strength**; the strongest match fills the expression and the gesture
  slot *independently*, so one line can laugh and point at once.
  `SHIPPED_POSE_RULES` is Microsoft's table transcribed verbatim (laughter 11 >
  emoticons 10 > shouting 9 > "are you" 8 > "i'm" 7 > greetings 5–2 — which
  answers the priority question the paper leaves open); `EXTRA_POSE_RULES` adds
  emoji, later acronyms, more openers, and rules for angry/scared/bored, which
  **no released version could trigger from text at all**. Callers can pass
  their own table via `inferPose(text, { rules })`, or through the composer
  with `ComposeInput.poseRules`. `Pose.dominant` records which slot the
  *stronger* rule filled, so whole-figure art can honour the table's own
  priorities (see `figureFor`).
- `manifest.ts` — character asset schema + validation. Two kinds: **layered**
  (heads-by-emotion × bodies keyed by **gesture or expression** — the original
  art ships emotional torsos: angry stances, laughing slumps, scared cowers)
  and **figure** (whole-figure single sprites keyed by pose). `bodyForPose`
  picks the torso the way the original client does (gesture wins, else the
  expression's stance, else cycling neutrals; smile/shrug borrow happy/bored).
  Panels carry `poseVariant` so renderers actually draw the §4.1 neutral
  cycling. Other helpers: `headForExpression`, `bodyForGesture` (legacy),
  `figureFor`, `isFigureManifest`, `isExpressive`, `characterProportions`.
  `figureFor` picks a whole-figure pose gesture-first, but falls through the
  same `BODY_FALLBACK` table `bodyForPose` uses (so `shouting` reaches an
  `angry` drawing instead of collapsing to neutral), and defers to `dominant`
  when inference ranked the expression higher — without which a strength-3
  pronoun rule outranks a strength-8 emotion. That matters enormously to a
  cast whose only emotional channel *is* the stance.
  `characterProportions(manifest, pose?)` measures the art actually being
  drawn rather than always the neutral pose; a wide gesture needs a wider
  frame, and understating it is what lets the §6.2 camera cut a character off
  at the panel edge.
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
  seed roll uses this (with the curated corpus surfacing ~1 in 7), so seeds are
  near-always unique instead of cycling a finite list. Every seeded comic is
  tuned to compose to exactly **6 panels** (`TARGET_PANELS`; a 2×3 download
  grid) — a compose-in-the-loop pass appends seeded reaction beats or trims a
  mid line. Only the seed roll is tuned; user-authored edits keep any count.
- `strip.ts` — tiles panels into one downloadable strip SVG; optional title band
  and a **"starring" cast panel** (`credits: true`), the original's `AddStars`
  curtain call — cast waving, ordered by how much each spoke, captioned
  "nickname as Character". Note nested `<svg x/y>` tiles: browsers position them
  correctly, but PyMuPDF ignores x/y and stacks every tile at the origin — check
  strip output in a browser (headless Chrome `--screenshot` works).
- `load-assets.ts` — loads manifests + inlines sprite/backdrop markup.
- `demo/` — the web demo. `build.ts` bundles `main.ts` → `app.js` (ESM, sprites
  inlined via esbuild `define`) and generates `index.html`; `style.css` is a
  hand-edited source file; `stage.ts` copies the set to the staging dir. Loads
  only its own files but needs http(s) (ESM). `main.ts` is the browser entry.

**Assets — `assets/comic-chat/`**: **31** real Comic Chat characters — all 22
from v1.0, the 6 Artpack 1 additions (Kevin, Kwensa, Maynard, Rebecca, Sage,
Scotty), and the 3 v2.5 color avatars (Buck, Kirby, Veronica) — plus **9** v2.5
backdrops (`NOTICE.md` has attribution — MS art is MIT). Quirk: `glenda.avb`'s
embedded name really is "Greg" upstream; we display it as-is.

**Tools — `tools/`** (one-time asset generation, Python + Pillow/numpy):
- `import-avb.py` — decodes `.avb` avatars → PNG sprites + JSON manifests.
  Handles both containers: v1.0 (magic `0x81`, plain BMPs) and v2.5 (magic
  `0x8181` — zlib-deflated bitmaps, masked-mono/dual-mask packed planes,
  local color palettes, offset-adjustment records).
- `import-bgb.py` — decodes `.bgb` backdrops (zlib + 4/8-bit indexed) → PNG.
- Regenerate: sparse-clone `microsoft/comic-chat`, point the tools at
  `v1.0/client/comicart/avatars` and `v2.5-beta-1/{comicart,artpack1}`.
- `import-character.py` — the **hand-drawn** intake: a folder of PNGs → a
  validated `character.json`. Layered by default; `--figures` for whole-figure
  art, `--headless` for a figure with no head. See "Custom character art".
- `vectorize-character.py` — traces a character's sprites to SVG in place and
  repoints the manifest. Needs OpenCV.
- `placeholder-character.py` — crude stand-in art in the importer's input
  format, so a cast member can exist before anyone has drawn anything.
- `import-backdrop.py` — the **hand-drawn backdrop** intake (`import-bgb.py` is
  a decoder, not an importer). Sizes to what the camera can actually ask for —
  `maxZoom` 2.2 × a 400px panel = 880px, so 900 — and drops channels the art
  does not use. `load-assets.ts` inlines each backdrop as a data URI **into
  every panel using it**, so weight is paid per panel. Judge "is it greyscale?"
  and "is it transparent?" by a percentile and a fraction, never by the maximum:
  real art carries stray coloured pixels and a soft edge column, and one outlier
  should not buy three colour channels.

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

## Deploying the demo (two mirrors)

The composer is served from two mirrors: **onionmadder.com** (primary, on
NearlyFreeSpeech) at <https://onionmadder.com/comic-chat-composer/>, and
**onionmadder.xyz** (Neocities mirror) at
<https://onionmadder.xyz/comic-chat-composer/>. The same file set serves both —
`canonical`/Open Graph point at the primary (.com), which is correct for a
mirror, so no per-host build is needed. (`SITE_URL` in `demo/build.ts` sets that
primary URL.)

`npm run deploy:stage` builds and copies the whole set (`index.html`, `app.js`,
`style.css`, `assets/ChakraPetch-Regular.ttf`) into **every** local staging
folder listed in `.stage-dir` (gitignored, one folder per line). Then publish
each — **all four files, preserving `assets/`**, confirming overwrites, then
hard-refresh (Ctrl+Shift+R):

- **.com** — WinSCP to `/home/public/comic-chat-composer/`. Files need 644 /
  dirs 755 if a 403 appears.
- **.xyz** — the Neocities uploader or CLI. Neocities is HTTPS with ES-module
  support, so the split set runs there unchanged.

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
3–4-person group chats) → **shareable permalinks** → **auto-shout** balloons
(yelled lines get the §5.1 starburst) → the establishing-shot **`fold`** rule
(the opening shot carries the first line instead of a blank panel) → **title
cards** on exports → the demo **split into an ES-module set** (`index.html` /
`app.js` / `style.css`) → a **procedural conversation generator** (`generate.ts`,
near-infinite unique seeds) → **published to GitHub** and **deployed to two
mirrors** (onionmadder.com primary + the onionmadder.xyz Neocities mirror).

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
   seed, scene, and title/subtitle into the URL hash (`#c=<base64url JSON>`);
   opening the link (fresh load or a pasted hash) reproduces the comic exactly.
   Fidelity relies on `resolveCast` treating a participant whose name *is* a
   character id as that character — so a Builder-authored comic (author =
   characterId) keeps its exact cast through `toScript()` → link → `parseLog`.
   Marks the comic `authored`, so the seed won't overwrite a shared script.
7. **Title cards on exports** — optional **Title** + **Subtitle** fields render
   as a header band on the downloaded strip (`renderStripSvg` in `strip.ts`, in
   comic lettering), with a small `onionmadder.com/comic-chat-composer` credit on
   any titled export; echoed live above the on-screen comic (`#comic-title`) and
   carried in the share-link state (`t`/`st`).

**Still open:**
- **Deeper Comic-Chat window chrome** — the member list is the big piece; the
  framing could go further if wanted (without copying Win95 literally).
- **Intensity plumbing** — thread the wheel's `intensity` (already on each row)
  from `expressionOverride` into inference/rendering. This is the one item that
  needs `src/` changes (`pose.ts`/inference + the manifest), and has little
  visible payoff until the asset set has per-intensity sprites — deferred.
- Seeds now procedurally generate (`generate.ts`, 23 templates) — ~903 distinct
  comics per 1000 seeds — so repeats are rare. Add templates/pools to widen more.

## Custom character art — the intake pipeline

Everything under `assets/comic-chat/` came out of Microsoft's binaries, which
carry explicit registration crosshairs. Hand-drawn art has none, so
`tools/import-character.py` gets them one of two ways, and the difference
matters: **place the markers.**

- **Marker pixels** (preferred). One opaque pixel of a reserved colour:
  magenta `#FF00FF` at the neck join (a head's `attach`, a body's `headAttach`),
  cyan `#00FFFF` at the face centre (a head's `tailAnchor`, §5.4). The importer
  reads them, repaints them to their surroundings, and **reports by filename**
  which sprites it had to guess on — that list is the QA pass.
- **Derivation** (fallback). Measured against the decoded cast, whose crosshairs
  are ground truth: median error ~3px on a torso but **up to 128px** on a wave,
  because a raised hand fools any rule that looks at the top of the silhouette.
  No heuristic tried beat that, and a head attached 60px off is instantly visible.

A marker must be **opaque, few, and clustered** — exported art carries
near-invisible `alpha=1` stragglers that land on exactly these RGB values,
scattered across the whole image, and averaging them puts the anchor nowhere.

**Two traps, both found the hard way:**

- **Never upscale at import.** The renderer scales every character to the
  panel's `characterHeightFraction` (`scale = characterHeight / bounds.height`),
  so sprite pixels buy **resolution and nothing else** — on-screen size is
  identical either way. Normalising art *up* to a target height costs sharpness
  for no gain, and costs it twice on a close-up. `MAX_FIGURE_HEIGHT` only ever
  scales *down*.
- **Luma needs int32.** `255 * 587` overflows 16 bits, so `astype(np.uint16)`
  makes white compute as luma 58 and every threshold reads paper as ink. This
  bit both the quantizer and the tracer.

**Vectorising** (`tools/vectorize-character.py`) is the answer when the source
art is smaller than its largest close-up and no higher-resolution original
exists. Comic Chat never looked soft because its ~345px sprites were always
being *downscaled* into ~200px panels; art that starts at ~290px has no such
luxury. Tracing to SVG makes the sprite resolution-independent, and needs no
change anywhere else — `src` is opaque to the composer, `load-assets.ts`
already inlines `.svg`, and the trace preserves the source's pixel coordinates
so every anchor and bound stays valid. On real line art it also came out
**60–70% smaller** than the PNGs.

Two findings worth keeping: **smoothing traced contours makes them worse**
(Catmull-Rom overshoots on an unevenly-spaced polygon and shreds 2px fold lines
into spikes — ink IoU 0.965 → 0.929), so the tracer emits polylines; and **IoU
against your own threshold mask proves nothing** — it only shows the tracer
matched the threshold. Score the reconstruction against the *original image*.
