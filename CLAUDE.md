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
> lives on the `mcomic96-app` branch and, as of 2026-08-04, is **submitted to
> Google Play and in review** — package `com.onionmadder.mcomic`, signed with a
> key at `~/Keystore-Backups/mcomic96/`. **Comic Court** (a webcomic) was
> extracted into its own repo at `projects/comic-court` once the two started
> diverging — it depends on this package and vendors the `examples/` render
> pipeline, which is the layer a strip keeps bending. Neither product should
> import from the other, and library fixes flow outward from here.
>
> **"Flow outward" is not automatic, and nothing warns you.** A fix landing in
> `src/` reaches a product only when that product pulls it: `mcomic96-app` by
> merging `main`, Comic Court by updating its dependency *and* re-vendoring
> whatever it copied out of `examples/`, and the live demo by someone running
> `npm run demo` and uploading the result. Each of those is a separate act a
> person has to remember. The demo silently ran four commits behind for five days
> this way — see Deploying.

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
  **Text containment is a property, not a hope**: the outline construction in
  `balloon-shape.ts` guarantees every glyph stays inside the balloon drawn
  around it, and `test/balloon-shape.test.ts` pins it with seeded sweeps.
  Three ways it used to fail, all fixed 2026-08-06 and worth not reintroducing:
  midpoint controls at the *mean* of two line widths sliced the wider line's
  corners (floored to clear the wider line now); cap/tail shoulder insets grew
  with balloon width (capped in margin terms now); and anti-amoeba rule 3
  could hold a *wider* line down to an earlier narrower width (flat runs sit
  at the widest requirement in the run now). Shout starbursts follow the
  balloon box's **rectangle** with a spike pinned at every corner — valleys on
  the inscribed ellipse clipped the corner glyphs of every multi-line shout,
  because a rectangle's corners lie outside its inscribed ellipse.
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
  `assets/`. **The application makes no third-party or network requests** — all
  sprites, backdrops and the font are inlined or co-located. The one exception is
  deliberate and lives entirely in `demo/head-extra.html`: onionmadder.com's
  GoatCounter tag, which is an external script. Delete that file and the build is
  request-free again. Because `app.js` is an ES module, the page must be **served
  over http(s)** (Neocities, onionmadder, the dev server) — it will not run from
  `file://`. `style.css` is the source of truth for styling — edit it directly,
  not `build.ts`. The public-site URLs live in `SITE_URL`/`REPO_URL` in
  `demo/build.ts`, and the social card in `SOCIAL_IMAGE` (empty ⇒ a text-only
  `summary` twitter card instead of `summary_large_image`).
- **`demo/head-extra.html` is deployment-specific `<head>`, injected verbatim.**
  It holds onionmadder.com's analytics tag and a schema.org identity graph —
  content that belongs to a *site*, not to this project. It exists because that
  block used to be hand-patched onto the live `index.html`, where every deploy of
  the generated file silently deleted it. **A fork that deploys the demo should
  replace or delete this file**; nothing else needs touching, and the build says
  which way it went on every run.

## The demo's layout — and three CSS traps under it

**The comic is never below the fold.** It used to be: stacked in source order it
began at 872px, so on a 910px-tall window a visitor saw 38px of it and had to
scroll to discover the page worked at all. Two arrangements fix that, and
`build.ts` wraps the page in `.col-left` (editor + cast) and `.col-right`
(comic) so both are one CSS rule each:

- **≥1030px — side by side**, comic right, `.col-right` sticky so editing a line
  never scrolls the result away. Comic at 177px; 4 of 6 panels visible at 1060px
  wide, all 6 at 1440.
- **<1030px — comic first**, order flipped to header → comic → editor → footer.
  Comic at 204px on a 375px phone. It is a demo before it is a tool: a visitor
  arrives to see whether a chat log really becomes a comic, and the answer
  should be on screen. **Every child needs an explicit `order`** — `order: -1` on
  the comic alone would hoist it above the site header, since the rest default
  to 0.

**The 1030px breakpoint is derived, not chosen.** A builder row needs ~679px to
sit on one line, plus card padding; 730 (editor) + 26 (gap) + 230 (comic) + 44
(page padding) = 1030. An earlier version picked a round 980 first and forced the
tracks to fit, which produced 198px-tall builder rows.

**Trap 1 — `1fr` is `minmax(auto, 1fr)`, and `auto` means min-content.**
`.workspace` and `.builder` both used a bare `1fr`. Neither track would shrink
below its content, so the page overflowed horizontally by **434px between 821px
and 979px wide** — for months, on the live site. Use `minmax(0, 1fr)` for any
track that must be allowed to shrink.

**Trap 2 — a mobile overflow can lock out its own fix.** A builder row's fixed
children need 679px in one line. That overflowed a 375px phone, so the browser
widened the *layout viewport* to 735px to shrink-to-fit — and at 735px the
`max-width: 680px` mobile rules stopped matching. The media query that would have
solved it could never fire. `.brow` therefore wraps **unconditionally**, which is
what breaks the loop, and wrapping is switched back off above 1030px where a row
has room for one line. Symptom to recognise: `window.innerWidth` disagreeing with
`document.documentElement.clientWidth`.

**Trap 3 — measure bytes against bytes.** Comparing a served file's
`(await r.text()).length` to a local byte count makes every non-ASCII character
look like a missing byte; `index.html` read 18 "short" and `style.css` 26 purely
from em-dashes. Compare `Buffer.length` to `Buffer.length`, or expect the delta.

## Deploying the demo (two mirrors)

The composer is served from two mirrors: **onionmadder.com** (primary, on
NearlyFreeSpeech) at <https://onionmadder.com/comic-chat-composer/>, and
**onionmadder.xyz** (Neocities mirror) at
<https://onionmadder.xyz/comic-chat-composer/>. The same file set serves both —
`canonical`/Open Graph point at the primary (.com), which is correct for a
mirror, so no per-host build is needed. (`SITE_URL` in `demo/build.ts` sets that
primary URL.)

One consequence of sharing one `index.html`: **the mirror carries the GoatCounter
tag too**, so `.xyz` traffic counts into the same account as `.com`. That is
right if you want total traffic across both. Separating them would mean a second
GoatCounter site and a per-host build, which this setup deliberately does not do
— so the alternative is simply not uploading `index.html` to `.xyz`.

**`examples/demo/app.js` is a committed build artifact, and it goes stale in
silence.** Nothing rebuilds it — not a test, not `typecheck`, not CI. A library
fix in `src/` looks entirely finished on `main` while the demo, and both live
mirrors, keep serving the old behaviour. It ran four commits behind for five days
in August 2026, publishing a panel-composition bug whose fix was already sitting
in `src/`.

So when the demo's behaviour is in question, **compare the bundle's last commit
against the sources'** rather than assuming they agree:

```bash
git log -1 --format='%h %ad %s' --date=short -- examples/demo/app.js
git log --oneline --since="$(git log -1 --format=%cI -- examples/demo/app.js)" \
  -- src/ examples/generate.ts examples/render-svg.ts examples/demo/main.ts
```

Anything listed by the second command is a change the live site does not have.

`npm run deploy:stage` builds and copies the whole set (`index.html`, `app.js`,
`style.css`, `assets/ChakraPetch-Regular.ttf`) into **every** local staging
folder listed in `.stage-dir` (gitignored, one folder per line).

**The generated `index.html` is now the whole page — uploading it is safe.**
It was not always: the live `.com` copy used to be hand-patched on the server
with analytics and a schema.org block that `build.ts` did not produce, so every
deploy of the generated file silently deleted them. The page still worked
afterwards, which is why it went unnoticed for as long as it did. That content
now lives in `demo/head-extra.html` and is injected at build time, so the
generated file is a superset of what was on the server and there is nothing left
to preserve by hand.

Then publish each — **preserving `assets/`**, confirming overwrites, then
hard-refresh (Ctrl+Shift+R):

- **.com** — WinSCP to `/home/public/comic-chat-composer/`. Files need 644 /
  dirs 755 if a 403 appears. **Scriptable** (no manual drag): `WinSCP.com
  /script=<file>` with the saved session
  `onionmadder_onionmadder@ssh.nyc1.nearlyfreespeech.net` authenticates from
  the stored password. One `put -permissions=644 <file> ./` **per file** —
  never `put a b c`: WinSCP treats the *last* argument as the remote target,
  and a multi-file put once wrote `app.js`'s content into the live
  `style.css`.
- **.xyz** — the Neocities uploader or CLI. Neocities is HTTPS with ES-module
  support, so the split set runs there unchanged. Uploads here are manual —
  no CLI or API key lives on the machine.

After either upload, verify bytes against bytes: fetch the live `app.js` with
a cache-busting query and `cmp` it to `examples/demo/app.js`.

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
mirrors** (onionmadder.com primary + the onionmadder.xyz Neocities mirror) →
**Comic Court split off** into its own repo → **mComic '96 submitted to Google
Play** (the library's first shipped product; the mobile work lives on
`mcomic96-app`) → a **demo layout pass**: the SEO head generated instead of
hand-patched onto the server, two long-standing horizontal-overflow bugs fixed,
and the comic moved above the fold at every width → a **balloon-containment
audit** (a 6,000-case geometric sweep found 57% of spline balloons and 48% of
shouts clipping text; three outline fixes + rectangle-based starbursts, pinned
by seeded containment tests) → the **pose-thumbnail emotion wheel** (each
wheel node renders the active character striking that emotion, so picking a
look is matching a face, not translating a vocabulary).

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
   but not yet consumed (see below). Each node is a **pose thumbnail** — the
   active character rendered in that emotion (head-and-torso crop, gesture
   pinned to neutral so the emotion's own look shows), cached per character;
   the needle and selection rings update in place so dragging never rebuilds
   nine rendered panels. With no character picked, the wheel falls back to the
   labelled dots.
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
- Seeds now procedurally generate (`generate.ts`, **40 templates**) — measured
  2026-08-04: **903 distinct comics per 1000 seeds, 8,626 per 10,000**. Repeats
  are rare but the space is finite; the collision rate implies an effective pool
  of roughly 5,000 distinct comics, i.e. ~125 variants per template. Both more
  templates and richer filler pools widen it, roughly linearly. (The count in
  this line read 23 for a while after it was 40 — if the number matters, count
  `TEMPLATES` rather than trusting it.)

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
