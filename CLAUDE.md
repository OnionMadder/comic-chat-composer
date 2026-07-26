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
npm run demo      # build the self-contained examples/demo/index.html
```

- **Node 22+, ESM, TypeScript strict.** Tests run directly off `.ts` via
  `--experimental-strip-types` — no compile before test.
- The published library is **`src/` only** and has **zero runtime dependencies**.
  Everything in `examples/` (renderer, demo, corpus, parsers) is not part of the
  package surface — it's reference code, and may use dev deps (esbuild).

## Architecture

**The library — `src/`** (pixel-free; emits a layout tree):
- `compose.ts` — the orchestrator. Event stream → `Panel[]`. Owns gesture/
  expression inference dispatch, character-inclusion + panel-break rules, the
  solo-panel roll, periodic establishing shots, one-scene-per-conversation
  backdrop choice, and assembling each panel.
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
- `corpus.ts` — 16 canned conversations the demo's seed selects from.
- `strip.ts` — tiles panels into one downloadable strip SVG.
- `load-assets.ts` — loads manifests + inlines sprite/backdrop markup.
- `demo/` — the self-contained web demo (`build.ts` inlines everything into one
  `index.html`; `main.ts` is the browser entry).

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
- **Demo is one self-contained file.** No external requests (fonts/sprites/
  backdrops all inlined). Verify after building: only the SVG xmlns URL should
  appear. It's ~2.2 MB.

## Deploying the demo (NearlyFreeSpeech.NET via WinSCP)

`npm run demo`, then drag `examples/demo/index.html` into WinSCP over the copy
in `/home/public/comic/`, **confirm the overwrite**, and hard-refresh
(Ctrl+Shift+R). Files need 644 / dirs 755 if a 403 appears.

## What's built (the arc so far)

Routing-channel balloon layout → §5.3 splined balloons → §6.2 head-anchored
camera → §6.1 halos → the full 22-character cast (incl. whole-figure avatars)
and 9 backdrops decoded from the original binaries → per-line hint directions →
cast control → one-room-per-conversation with an even scene spread → a
golden-master safety net (which caught and fixed a dropped-message bug) →
cross-checked `maxAllowable` against the C++ (a real min→max fix) → a redesigned
demo → the Onion neon "onionized" house style → a conversation corpus the seed
selects from → a low-vision readability pass.

## TODO — next: a Comic-Chat-style conversation builder

The demo currently authors conversations as a **text script** in a textarea.
Onion wants a **modern, super-easy form-based builder** that also **evokes the
real Microsoft Comic Chat interface** (see the reference screenshot: member
list, character-preview pane, and the emotion wheel). Keep the text-script mode
too (power users / paste), but lead with the builder.

1. **Row-based conversation builder.** One row per line, form-style:
   - a **character dropdown** (who's speaking) — pulls from the cast,
   - a **text field** for the line,
   - an **emote control** (see the wheel below),
   - optional **addressee** ("to →") and **balloon kind** (say / whisper /
     think / action).
   - Add / remove / reorder (drag) rows. Adding a row shouldn't require learning
     the `name (hint): text` syntax — the builder *produces* that under the hood
     and feeds the same `parseLog`/composer path.
2. **The emotion wheel.** Recreate Comic Chat's actual wheel: the 8 emotions on
   a perimeter (happy, laughing, coy, shouting, angry, sad, scared, bored) with
   **neutral at center** and **intensity = radius**. Click/drag to set a line's
   emotion. This is iconic — make it a real, tactile control, not a dropdown.
   Maps to `expressionOverride` (+ intensity if we thread it through).
3. **"The little Comic Chat head guy" — character preview.** Comic Chat shows
   the selected character's figure/head reacting live (the wolf in the ref
   shot). Integrate a **live preview** of the chosen character in the chosen
   emotion/gesture (reuse the renderer's head/figure resolution). Show it beside
   the builder and/or in the emote wheel's center.
4. **Comic-Chat window styling, modernized.** Evoke the classic layout — a
   member/cast list panel, the character preview, the emote wheel — but in the
   Onion neon aesthetic (already established in `demo/build.ts`: Chakra Petch
   display + readable sans body, deep-black + pink/cyan/violet, glow). Don't
   copy the Win95 chrome literally; channel it.
5. **Gesture control too** (wave / point-self / point-other / shrug / smile) —
   maps to `gestureOverride`. Could be a small set of buttons next to the wheel.
6. Nice-to-haves: bigger corpus (some seeds currently repeat a conversation);
   per-character neon cast-pill colors (the brand has amber/lime/violet buckets
   we didn't wire in); optional intensity plumbed from wheel radius into the
   composer/renderer (the manifest/inference don't consume intensity yet).

**Where things plug in:** the builder is pure `examples/demo/` work — emit the
same event/hint shape `parseLog` already produces (or build `ChatEvent[]`
directly and skip parsing), then call `compose` + `renderPanelToSvg` exactly as
`main.ts` does now. Emotion/gesture map to `expressionOverride`/`gestureOverride`
on `MessageEvent`. The head preview reuses `headForExpression`/`figureFor` +
`renderPanelToSvg`'s character path. No library (`src/`) changes needed for the
core builder — unless we decide to thread emote **intensity** through, which
would touch `pose.ts`/inference and the manifest.
