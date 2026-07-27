# comic-chat-composer

Turn a chat log into comic panels.

This library implements the panel-composition algorithm from Microsoft Comic Chat: it decides how a conversation breaks into panels, who appears in each one, where they stand, which way they face, what expression and gesture they wear, and where every speech balloon and its tail goes.

It composes only. The output is a layout tree — geometry and identity, no pixels — so you can render it to SVG, canvas, print, or anything else. Zero runtime dependencies.

```ts
import { compose } from 'comic-chat-composer';

const panels = compose({
  events: [
    { type: 'join', author: 'alice', at: 0 },
    { type: 'join', author: 'bob', at: 1 },
    { type: 'message', author: 'alice', text: 'Hi Bob!', at: 2 },
    { type: 'message', author: 'bob', text: "Hey Alice, LOL you're back", at: 3, addressees: ['alice'] },
    { type: 'action', author: 'alice', text: 'waves cheerfully', at: 4 },
    { type: 'message', author: 'alice', text: 'I MISSED YOU!!!', at: 5, addressees: ['bob'] },
  ],
  cast: {
    alice: { characterId: 'nib' },
    bob: { characterId: 'nib' },
  },
  backdrops: ['room', 'field', 'pastoral'],
  seed: 1234,
});
```

Each panel comes back like this:

```ts
{
  panelIndex: 2,
  zoom: 'medium',
  camera: { x: 21, y: -94, width: 357, height: 268, scale: 1.12 },  // §6.2 framing
  backdrop: 'pastoral',
  characters: [
    { author: 'alice', characterId: 'nib', x: 133, facing: 'right', gesture: 'wave', expression: 'neutral' },
    { author: 'bob',   characterId: 'nib', x: 267, facing: 'left',  gesture: 'wave', expression: 'laughing' },
  ],
  balloons: [
    {
      speaker: 'alice', kind: 'speech', text: 'HI BOB!', lines: ['HI BOB!'],
      x: 81, y: 8, width: 59, height: 33,
      tail: { fromX: 107, fromY: 41, toX: 133, toY: 113, curve: 'ccw' },
      readingOrder: 0, continued: false,
    },
    // ...
  ],
}
```

## What it does

**Gesture and expression inference.** Message text is scanned for cues — emoticons, chat acronyms (`LOL`, `IMHO`, `BRB`), all-caps, emphatic punctuation, sentence-initial greetings and pronouns — and mapped to a gesture and a facial expression. Explicit overrides win. When nothing matches, the character cycles through its neutral poses so repeated plain messages don't produce identical panels.

**Character placement.** Characters are seated along a row and turned to face each other by minimising a scoring function over ordered pairs. The dominant term is a heavy penalty for a speaker who isn't facing the person they addressed; lighter terms discourage bystanders standing between conversational partners and discourage characters moving between panels.

**Balloon layout.** Balloon bodies are placed greedily above the character row, each one reserving a *routing channel* — a horizontal interval kept free for its tail. As bodies are placed they trim their own channel so earlier channels stay wide enough for a tail, then shrink earlier channels so nothing overlaps. Vertical placement then pushes each balloon as high as reading order allows, and tails are routed last. Reading order is strictly top-down, then left-to-right.

**Panel breaks.** A new panel starts when a balloon can't fit, when the cast would exceed five, when a character would speak twice, or when a character already drawn would need a different expression. There's also a small random chance of giving a long opening utterance a solo panel.

**Camera framing.** Each panel gets a virtual camera that pulls in to the tightest shot the comic rules allow — never cutting a character at the neck or ankles, never cutting a required character at the panel sides — and pulls back to an establishing shot on joins and periodically. Pass `characterAssets` (the character manifests) so it can frame from real proportions. The balloons stay put; only the character layer is zoomed.

**Determinism.** All layout randomness comes from a seeded PRNG. The same events, cast and seed always produce the same panels — which is both testable and a property of the original design, where every client composed its own view of the stream with nothing to reconcile.

## Character assets

Characters are described by a JSON manifest. Most are *layered*: heads and bodies are separate sprites that combine freely — any head on any body — which is how a small set of drawings covers the whole gesture × expression matrix. Some characters are instead *whole-figure* (`figures` in place of `heads`/`bodies`): one complete sprite per pose, with the expression and gesture baked in and no separable head. The composer treats both the same; only the renderer branches.

```jsonc
{
  "id": "nib",
  "name": "Nib",
  "heads": {
    // hap laf coy neu sad ang sho — all seven required
    "neu": {
      "src": "head-neu.svg",
      "attach": { "x": 20, "y": 36 },      // meets the body's headAttach
      "tailAnchor": { "x": 20, "y": 20 },  // where balloon tails point
      "halo": { "x": 2, "y": 2, "width": 36, "height": 36 }
    }
  },
  "bodies": {
    // keyed by gesture; each is a list of variants that cycle
    "neutral": [
      { "src": "body-neutral-1.svg", "headAttach": { "x": 30, "y": 8 }, "bounds": { "x": 0, "y": 0, "width": 60, "height": 90 } }
    ]
  },
  "backdropPreferences": ["room", "field"]
}
```

Validate one with `parseCharacterManifest` (throws, listing every problem) or `validateCharacterManifest` (returns errors). Sprite sources are opaque strings — PNG, SVG, data URIs, whatever your renderer understands.

A reference character, **Nib**, ships in [`assets/characters/nib/`](assets/characters/nib/): a placeholder stick figure with all seven expressions and six gestures as inline SVG. It exists so the library has something to compose against with no third-party art in the loop.

### Real Comic Chat characters

All twenty-two of the original **Microsoft Comic Chat** v1.0 characters — Anna, Hugh, Tiki, and the rest — are also bundled, under [`assets/comic-chat/`](assets/comic-chat/), along with the room/field/pastoral backdrops. Comic Chat's art shipped in a binary `.avb` format; [`tools/import-avb.py`](tools/import-avb.py) decodes it (the format read straight from Comic Chat's own loader source) and converts each avatar to the same manifest shape as Nib. Fifteen are layered (separate head + body sprites with the original neck-crosshair and face-centre anchors); the other seven — Tux, Waf, Connor, Jordan, and three single-pose figures — are whole-figure. The demo casts a different one to each participant.

This art is Microsoft's, MIT-licensed and redistributed with attribution — see [`assets/comic-chat/NOTICE.md`](assets/comic-chat/NOTICE.md). It is bundled art, not a Microsoft-endorsed product; this project is independent and unaffiliated (details under [Credit and provenance](#credit-and-provenance)).

## Seeing it work

```sh
npm install
npm run demo
```

That writes a small set of co-located files to `examples/demo/`: `index.html`, `app.js` (the composer, renderer and every sprite bundled as one ES module), and the hand-edited `style.css`. It makes **no third-party or network requests** — it loads only its own files — but because `app.js` is an ES module it must be **served over http(s)** (any static host works; it won't run from `file://`). Drop it on any static host and it just works. Edit the chat log in the page and panels recompose live, and **Download PNG / SVG** saves the whole strip as one image (pick the number of columns first).

There's also a terminal walkthrough of the layout tree:

```sh
npm run example
```

## Rendering

The composer emits geometry, not pixels — so you need a renderer. [`examples/render-svg.ts`](examples/render-svg.ts) is a working reference one: balloon bodies are the paper's §5.3 splines (see below), tails are spliced into the same outline as a single path, thought balloons get a chain of ovals, whisper balloons get a dashed outline over a halo, narration boxes are plain rectangles.

```ts
import { compose } from 'comic-chat-composer';
import { renderPanelToSvg } from './render-svg.ts';

const panels = compose({ /* ... */ });

const svg = renderPanelToSvg(panels[0], {
  characters: { nib },                     // manifests by characterId
  sprite: (src) => spriteMarkup[src],      // src → inline SVG markup
  backdrops: { room, field, pastoral },    // id → scene art (world coords)
  panelWidth: 400,
  panelHeight: 300,
});
```

It's an example rather than package API on purpose — copy it and change it. Balloon bodies are built by [`examples/balloon-shape.ts`](examples/balloon-shape.ts), which implements the paper's §5.3 construction in full: a closed B-spline at tension 5.0 fitted around the text, with both anti-amoeba rules and the low-frequency perturbation that keeps the outline from looking machine-drawn. Pass `backdrops` (scene art in world coordinates, e.g. [`assets/backdrops/`](assets/backdrops)) and the renderer draws them behind the characters through the camera transform, with a white halo (§6.1) lifting each character off the scene. [`docs/ALGORITHM.md`](docs/ALGORITHM.md) explains the details the paper leaves unstated.

[`examples/parse-log.ts`](examples/parse-log.ts) turns plain text (`alice: hi`, `alice -> bob: hi`, `* alice waves`) into composer events, if you'd rather not build them by hand.

## Using it in your own project

Not published to npm yet. Until it is:

**Local path dependency** — best while both are on your machine:

```jsonc
// your-site/package.json
{ "dependencies": { "comic-chat-composer": "file:../comic-chat-composer" } }
```

```sh
cd comic-chat-composer && npm run build   # populates dist/
cd ../your-site && npm install
```

**Tarball** — pin an exact snapshot, or copy it to another machine:

```sh
npm run build && npm pack        # → comic-chat-composer-0.1.0.tgz
cd ../your-site && npm install ../comic-chat-composer/comic-chat-composer-0.1.0.tgz
```

**Straight into a browser, no bundler** — `dist/` is plain ESM with relative imports, so a browser can load it directly once it's served over HTTP:

```html
<script type="module">
  import { compose } from '/vendor/comic-chat-composer/dist/index.js';
  const panels = compose({ /* ... */ });
</script>
```

Copy `dist/` to `/vendor/comic-chat-composer/` after running `npm run build`. This won't work from `file://` — browsers block module loading over that scheme. Use the self-contained demo page for offline poking.

Requires Node 22 or newer. ESM only, zero runtime dependencies.

## Try it

```sh
npm install
npm test
```

## Credit and provenance

The algorithm is described in:

> David Kurlander, Tim Skelly and David Salesin. **"Comic Chat."** *Proceedings of SIGGRAPH '96*, pp. 225–236.
> [kurlander.net/DJ/Pubs/SIGGRAPH96.pdf](https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf) · [dl.acm.org/doi/10.1145/237170.237260](https://dl.acm.org/doi/10.1145/237170.237260)

Section references throughout the source (§4.3, §5.2, §5.4, …) point at that paper. [`docs/ALGORITHM.md`](docs/ALGORITHM.md) records where this port follows the paper exactly, where it fills in detail the paper leaves out, and where it deliberately diverges.

Microsoft released the original Comic Chat source under the MIT license at [github.com/microsoft/comic-chat](https://github.com/microsoft/comic-chat).

**This is an independent open-source reimplementation, written from the published paper.** No code is copied or translated from the Microsoft release — the composer and renderer are original. It is not affiliated with, sponsored by, or endorsed by Microsoft or the paper's authors.

The **character and backdrop art** under [`assets/comic-chat/`](assets/comic-chat/) is the exception to "nothing from Microsoft": it is Microsoft's own art, MIT-licensed, format-converted and redistributed under that license with attribution — see [`assets/comic-chat/NOTICE.md`](assets/comic-chat/NOTICE.md). Comic Chat's balloon *style* was drawn by Jim Woodring; the balloon shapes here are generated by [`examples/balloon-shape.ts`](examples/balloon-shape.ts) from the paper's algorithm, not traced from his art.

## License

MIT © 2026 Onion Madder. See [LICENSE](LICENSE). Bundled Microsoft Comic Chat art is separately MIT-licensed by Microsoft — see [`assets/comic-chat/NOTICE.md`](assets/comic-chat/NOTICE.md).
