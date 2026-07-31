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
> mirrors (see Deploying, below). **Active work: the `mComic '96` mobile app on
> branch `mcomic96-app`** (see "The mComic '96 app" section) — not yet merged.

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
  their own table via `inferPose(text, { rules })`.
- `manifest.ts` — character asset schema + validation. Two kinds: **layered**
  (heads-by-emotion × bodies keyed by **gesture or expression** — the original
  art ships emotional torsos: angry stances, laughing slumps, scared cowers)
  and **figure** (whole-figure single sprites keyed by pose). `bodyForPose`
  picks the torso the way the original client does (gesture wins, else the
  expression's stance, else cycling neutrals; smile/shrug borrow happy/bored).
  Panels carry `poseVariant` so renderers actually draw the §4.1 neutral
  cycling. Other helpers: `headForExpression`, `bodyForGesture` (legacy),
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
mirrors** (onionmadder.com primary + the onionmadder.xyz Neocities mirror) → the
full **31-character cast** (Artpack 1 + v2.5 color avatars, both `.avb`
containers decoded) → **emotional torsos** (`bodyForPose`) → a **paper-fidelity
+ C++ archaeology pass** (cloned `microsoft/comic-chat`; adopted the shipped
`chat.rc` emotion **rule table** with real strength priorities, fixed two §4.3
placement bugs, added **wordless reactions** / **explicit breaks** / a
**"starring" credits panel**, rewrote `docs/ALGORITHM.md` around paper-vs-port-
vs-shipped-program) → **the mComic '96 mobile app** (Capacitor chat-to-comic —
see the section below; this is the active workstream).

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

## The mComic '96 app (`app/`) — the mobile product

A separate consumer app that wraps the composer + renderer: **mComic '96**, a
single-device **chat-to-comic messenger** for Android (you role-play a
conversation on one phone and it draws itself into a comic). Lives in `app/`,
its own Capacitor project with its **own `package.json`/`node_modules`** — the
faithful library root stays zero-dependency and untouched. Homage name, not a
claim (evokes Comic Chat 1996 without the trademark; carries the "not
affiliated" + MIT-art-attribution line). Branch: **`mcomic96-app`**.

**App files** (`app/`):
- `branding.ts` — the onionized identity as data: name, tagline, Comic Sans
  stack, the neon palette (`--void #08080B`, cyan `#2CFFE6`, pink `#FF3D9A`,
  lime `#B6FF3D`), and stable per-speaker neon colors.
- `cast-names.ts` — an **app-only** overlay renaming all 31 characters, keyed by
  the internal id (Anna→Cleo, Bolo→Ren, glenda→Dawn fixing the "Greg" quirk,
  Maynard→Warren the rabbit, lance→Manila the paper bag, etc.). The **library
  keeps the original names** — only the app relabels, via `castName(id)`.
- `main.ts` — app state (`events`/`cast`/`speaker`/`scene`/`seed`) + the compose
  UI + the append-only render loop (see below). Reuses `compose()` +
  `renderPanelToSvg()` end to end.
- `wheel.ts` — the press-drag emotion wheel (8 emotions + neutral centre, radius
  = intensity, `<0.2` snaps neutral — the shipped body-cam detente), driving the
  pending pose + a live speaker preview.
- `build.ts` — esbuild bundles `main.ts`→`www/app.js` (assets inlined), inlines
  **Comic Neue (OFL) as a data-URI** into `www/style.css`, generates
  `www/index.html`. Cache-bust `app.js?v=<Date.now()>` + a faint header build
  stamp `b<HH:MM:SS>` (**dev aid — remove before release**). `www/` is
  gitignored (generated). Run: `cd app && npm run build`.
- `style.css` — mobile neon layout (pinned compose bar, webtoon comic scroll).
- `devserve.py` — a **no-cache** static server (`python devserve.py 8973`,
  binds 0.0.0.0) so a phone on the same wifi loads `http://<PC-LAN-IP>:8973`
  and every refresh is fresh. Capacitor `android/` project builds a real APK.

**⚠️ Device rendering — the hard-won lessons (read before touching the render):**
- **Headless Chrome cannot render this app faithfully** and its screenshots are
  useless for judging it: it drops SVG-`filter`ed groups (the §6.1 halo), it
  mis-renders nested camera-zoom transforms (characters vanish / land wrong),
  and it won't apply an inline `@font-face` (balloon text falls back to a wide
  serif and clips). **Trust only** the Browser-pane `getBBox` geometry (real
  Chromium = the device) and the **user's actual phone**.
- **The device's Chrome won't paint the §6.2 zoom-camera transform** on the
  character layer, nor the `feMorphology` halo nested under it → characters were
  invisible. Fix: the app renders at an **identity camera** (no zoom) with the
  **halo off** — both via opt-in `RenderOptions` (`halo`,
  `characterBaselineFraction`, added to `render-svg.ts`, defaults keep the
  faithful demo unchanged). Characters are posed directly.
- **Font:** Android ships no comic font, so the app bundles **Comic Neue**
  inlined as a data-URI, and gives the composer a width margin
  (`createApproximateMetrics({ advanceRatio: 0.7 })`) so balloon text never
  clips.

**Mobile framing** (settled with the user, on-device):
- **Square panels (400×400)** matching the square backdrops (no crop/stretch,
  room to stand characters — the original's shape).
- Characters **stand in the scene** at identity camera (`characterHeightFraction`
  ≈0.72, feet on the ground, balloons in the top ~40%), up to 3 per panel.
- **Scenes curated** to clean backdrops (`room`/`field`/`pastoral`); the busy
  color rooms are held back (`buckroom` hides a genuine, apparently-undocumented
  bootleg-**Cyclops** poster easter egg high on the wall — real decoded MS art).
- **Opening comic defaults to 3 panels** (`capToPanels` keeps the longest line
  prefix that composes to ≤3).
- **Transcript / append-only:** a drawn panel must **never recompose** when the
  next line arrives. Each send emits a `PanelBreakEvent`; `composePanels()` +
  `appendPanels()` add only new panels, `repaintAll()` is only for a fresh comic
  or undo. Verified: a new line adds one panel and leaves every existing panel's
  DOM byte-identical.

**Native shell (Capacitor 8 + Android):** `appId com.onionmadder.mcomic96`,
targetSdk 36, minSdk 24. Builds a real APK: `cd app && npx cap sync && cd
android && ./gradlew assembleDebug`. **Requires JDK 21** — pinned via
`org.gradle.java.home` in `android/gradle.properties` (Temurin 21; JDK 17 is
first on PATH and fails with "invalid source release: 21").

**Milestones:** M1 foundation ✅ · M2 compose UI ✅ · M3 emotion wheel ✅ ·
native shell ✅ (APK builds; store assets pending) · mobile framing ✅.
Remaining: **M4** export & share (wire `strip.ts` to a PNG/Web-Share), M5
onboarding, M6 PWA (installable/offline), M7 store assets + release signing, M8
release polish (remove the build stamp; framing nudges — head a touch lower,
two-shot spacing; rein in the bold color avatars).

**▶ IMMEDIATE NEXT TASK — make panels editable** (this is where a fresh session
resumes). It's not an authoring tool until you can fix a typo, change the
speaker, or delete a beat. The user chose the model: **tap a panel → edit that
beat.** Plan: move to **one line per panel** throughout (starter = the first 3
lines, a `break` between every line, so panel `i` ↔ the `i`-th content event —
trivial mapping), then tapping a panel loads that line into the compose bar as
an editor (speaker / text / emotion wheel / gesture / delivery / addressee) with
Send becoming **Update**, plus **delete**. Trade-off the user accepted: panels
become single-beat (speaker + addressee two-shots stay; 3-in-one-panel grouping
goes). Not started.
