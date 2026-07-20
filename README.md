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
  zoom: 'close',
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

**Determinism.** All layout randomness comes from a seeded PRNG. The same events, cast and seed always produce the same panels — which is both testable and a property of the original design, where every client composed its own view of the stream with nothing to reconcile.

## Character assets

Characters are described by a JSON manifest. Heads and bodies are separate sprites that combine freely — any head on any body — which is how a small set of drawings covers the whole gesture × expression matrix.

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

A reference character, **Nib**, ships in [`assets/characters/nib/`](assets/characters/nib/): a placeholder stick figure with all seven expressions and six gestures as inline SVG. It exists so the library has something to compose against in tests and examples.

## Install

```sh
npm install comic-chat-composer
```

Requires Node 22 or newer. ESM only.

## Try it

```sh
npm install
npm test
npm run example
```

## Credit and provenance

The algorithm is described in:

> David Kurlander, Tim Skelly and David Salesin. **"Comic Chat."** *Proceedings of SIGGRAPH '96*, pp. 225–236.
> [kurlander.net/DJ/Pubs/SIGGRAPH96.pdf](https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf) · [dl.acm.org/doi/10.1145/237170.237260](https://dl.acm.org/doi/10.1145/237170.237260)

Section references throughout the source (§4.3, §5.2, §5.4, …) point at that paper. [`docs/ALGORITHM.md`](docs/ALGORITHM.md) records where this port follows the paper exactly, where it fills in detail the paper leaves out, and where it deliberately diverges.

Microsoft released the original Comic Chat source under the MIT license at [github.com/microsoft/comic-chat](https://github.com/microsoft/comic-chat).

**This is an independent open-source reimplementation, written from the published paper.** No code is copied or translated from the Microsoft release. It is not affiliated with or endorsed by Microsoft or the paper's authors. Comic Chat's balloon style was drawn by Jim Woodring, whose artwork is not part of this package.

## License

MIT © 2026 Onion Madder. See [LICENSE](LICENSE).
