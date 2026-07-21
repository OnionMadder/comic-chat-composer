# Porting notes

Where this implementation follows Kurlander, Skelly & Salesin's SIGGRAPH '96 paper exactly, where it fills in detail the paper leaves unstated, and where it deliberately diverges.

Section numbers refer to [the paper](https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf).

---

## §4.1 — Gesture and expression inference

**Followed.** The trigger set is the paper's: emoticons, chat acronyms, all-caps, emphatic punctuation, sentence-initial greetings and pronouns, and neutral-pose cycling when nothing fires.

**Filled in.** The paper says multiple triggers are resolved by a fixed priority but never enumerates it. `src/pose.ts` evaluates rules in array order with later entries winning, gesture and expression tracked independently, and puts emphatic typesetting last so shouting survives an earlier match. This is a guess at the original ordering and is flagged with a `TODO` in the source — confirming it needs the v1.0 C++ sources, which the extraction plan notes were unreadable from the research sandbox.

**Diverged.** Greeting/pronoun rules only fire at the start of a trimmed message, so `"she said Hi to me"` does not produce a wave. The paper says "at sentence start"; anchoring to the message start is a stricter reading that avoids obvious false positives.

---

## §4.3 — Character position and orientation

**Followed.** The scoring function and all six weights are the paper's, exposed as `rules.facingPenalties`:

| Condition | Weight |
|---|---|
| `a` addressed nobody and is not facing `b` | 4 |
| `a` addressed nobody and `b` is not facing `a` | 2 |
| `a` addressed `b` and `b` is not facing `a` | 4 |
| `a` addressed `b` and `a` is not facing `b` | **40** |
| per character between `a` and their addressee | 4 × n |
| per position change since the previous panel | 1 |

The greedy solver is also the paper's: place character 1 (1 slot × 2 facings), then character 2 (2 slots × 2 facings), and so on, keeping the lowest-scoring option at each step.

**Diverged — added a local search and an exhaustive pass.** The paper concedes its greedy "does an adequate job" without claiming optimality. Two failure modes showed up in testing:

1. Greedy fixes the first character's facing before any sibling exists to score against. That arbitrary choice can pin the panel into a layout where a speaker faces *away* from the character they addressed — the exact outcome the 40-point penalty exists to prevent.
2. Greedy seats characters in arrival order, so a bystander can end up standing between a speaker and their addressee. With three characters where `alice` addresses `cara`, greedy scored 10 against an optimum of 6 — the whole gap being the `addrBetweenFactor` term, which greedy cannot undo once the bystander is placed.

`placeCharacters` therefore accepts any facing flip or position swap that strictly improves the total, and then — for casts of five or fewer, which is every panel the composer builds, since the paper caps a panel at five — enumerates every seating and facing outright. Ties always keep the incumbent, so greedy's arrival-order seating and the previous panel's positions survive as tie-breakers, which is what stops characters shuffling between panels for no reason. Casts above five keep the greedy + local-search result, since the factorial search would be too expensive.

`test/placement.test.ts` brute-forces the optimum for casts of two through five and asserts the solver reaches it.

---

## §5.2 — Balloon layout

The most detailed algorithm in the paper, and the core of this library. `PlaceBalloons`, `MaxAllowable` and `ReduceChannel` are ported structurally, with the following notes.

### `MaxAllowable` — the pseudocode can widen, the prose says trim

Published:

```
function MaxAllowable (Ri, xi, Rj, xj):
  R := Rj
  if xi < xj then  R.l := max{Ri.l + t, xi}
  else             R.r := min{Ri.r - t, xi}
  return R
```

Assigning `R.l` outright *widens* `Rj` whenever `max{Ri.l + t, xi}` falls left of the existing `Rj.l`. The surrounding prose is explicit that the operation only ever trims — "we trim the routing channel Rj just enough to ensure that…". The bounds are folded in monotonically here so the channel can only shrink.

### `ReduceChannel` — the pseudocode returns the wrong variable

Published:

```
function ReduceChannel (Ri, xi, Rj, xj)
  R := Ri
  if xi < xj then Ri.r := min{Ri.r, Rj.l}
  else            Ri.l := max{Ri.l, Rj.r}
  return R
```

It copies `Ri` into `R`, mutates `Ri`, then returns the unmutated `R`. The evident intent is to return the reduced interval, which is what this port does.

### Target width

Followed as described: estimate body area from a single typeset line scaled by 4/3 for line breaks and leading; leave short lines unbroken; otherwise take the minimum width as the greater of the widest single word and `area / allowableHeight`, and draw the target randomly between that minimum and the panel width.

**Filled in.** The paper defines `allowableHeight` as the distance from the bottom of the lowest previously placed balloon to the bottom of the balloon rectangle — but horizontal placement runs *before* vertical placement, so at that point no balloon has a final `y`. This port accumulates a running stacked height as balloons are placed and uses that as the conservative estimate, which matches the paper's stated intent ("a conservative estimate").

**Filled in.** "If the line is short" is unquantified. Default threshold: 40% of the panel width, exposed as `shortLineWidth`.

### Vertical placement

**Followed.** A balloon is placed no higher than the bottom of any balloon already placed to its right, and no higher than the top of any placed to its left, as high as those rules allow.

**Diverged — horizontally overlapping bodies must clear each other.** The "to its left" case permits *equal* height, which is only safe while the two bodies are horizontally disjoint. Routing channels partition the space reserved for **tails**; they do not stop a balloon *body* from extending over a neighbour's channel. Two balloons can therefore end up at the same `y` while overlapping in `x`, and render on top of each other.

This is not hypothetical — it happened on the fifth panel of the example log:

```
0. "I MISSED YOU!!!"                  x=119 y=8 107×33   → spans 119–226
1. "IMHO YOU SHOULD VISIT MORE OFTEN" x=167 y=8 232×48   → spans 167–399
```

Both at `y=8`, overlapping across 167–226. The vertical pass now requires a balloon that overlaps horizontally to clear the other outright, which also keeps it later in the reading order. `test/balloons.test.ts` and `test/compose.test.ts` both assert no two balloons in a panel intersect as rectangles.

### Oversized text

**Followed.** Text that cannot fit a panel on its own is split into fragments that do, joined by ellipses.

---

## §5.4 — Tail construction

**Followed.** Tails leave from under the last line of text where a large enough part of that line spans the routing channel, staying clear of the channel edges so they don't run flush against a neighbour. Failing that they attach within the channel at a small horizontal offset from the speaker's head. All tails in a panel come to a point at roughly the same height, below the lowest balloon and within the lowest third of the balloon region. Tails starting left of the speaker curve counterclockwise, those starting right curve clockwise, and both end above the centre of the speaker's face.

The composer emits the tail as `{ fromX, fromY, toX, toY, curve }` — endpoints and a direction, not a stroked path. The reference renderer turns that into a solid tapered shape spliced into the speech-balloon outline (see §5.3 above), or a chain of shrinking ovals for a thought balloon.

---

## §5.3 — Balloon body construction

**Not in the library; implemented in the reference renderer** ([`examples/balloon-shape.ts`](../examples/balloon-shape.ts)). §5.3 describes how to *draw* an outline around laid-out text, which is a rendering concern — the composer emits only the text broken into lines plus a bounding box. But because it is the single biggest thing standing between the output and something that reads as hand-drawn, the reference renderer implements it in full rather than boxing the text.

All four of the paper's rules are ported:

1. **Margin.** Line boundaries are expanded outward before splining.
2. **No inward dip** (anti-amoeba, rule 1). A line narrower than both neighbours is raised to the smaller of them, so the outline never pinches in on one line only to bulge back out.
3. **Ignore small changes** (anti-amoeba, rule 2). The outline holds its position until the text demands a move larger than a threshold.
4. **Low-frequency perturbation.** Runs of lines whose outline doesn't move get control points nudged alternately toward and away from the text — the paper's last remaining gap from Woodring's hand-drawn originals.

The outline is a closed cubic B-spline at tension 5.0 (the paper's value). Three things the paper does not spell out had to be worked through:

- **Tension has no stated scale.** The paper's "5.0" is presumably its own spline library's. It is mapped here as `t / (t + 5)`, a smooth 0→1 ramp that puts 5.0 at exactly 0.5 — 0 being a pure uniform B-spline and 1 collapsing onto the control polygon.
- **A B-spline does not pass through its control points.** Feeding the balloon boundary in directly yields an outline visibly *tighter* than intended — the widest line of text spills outside the balloon drawn to hold it. `fitControlPoints` corrects for this by iterative refinement: evaluate where the curve actually lands, push each control point by the shortfall, repeat. The correction is capped and bounded so a sharp contour change can't throw a control point out into a spike.
- **Tails are spliced into the same closed spline**, not drawn as a separate shape, so body and tail share one continuous outline. The tip is given control-point multiplicity 3, which forces the spline to interpolate it exactly and produce the sharp point a tail needs.

The one §5.3 element deliberately left out is fitting the spline to the actual glyph outline of a specific font; the renderer fits to measured line widths instead, and pins the drawn text to those widths with SVG `textLength` so the outline and glyphs agree in any environment.

---

## §5.5 — Rendering

**Partly relevant.** One rule affects composition rather than drawing: balloon text is displayed in all caps regardless of how it was typed. That is applied here, to every balloon kind except `narration`. Halos, dashed whisper outlines and comic lettering are all renderer concerns; the manifest schema carries per-sprite halo bounds so that data travels with the art.

---

## §6.1 — Backdrops and halos

**Renderer concern, supported by the schema and the reference renderer.** Comic Chat draws characters over a backdrop and gives each a white halo so it doesn't disappear into a busy background — the paper's Figure 3 makes the case starkly. The composer stays out of this: it picks a backdrop id per panel (cycling on establishing shots, honouring a character's `backdropPreferences` is a natural extension) and the manifest carries per-sprite `halo` bounds so that data travels with the art. Drawing is left to the renderer.

The reference renderer ([`examples/render-svg.ts`](../examples/render-svg.ts)) takes an optional `backdrops` map — scene art in world coordinates — and draws it behind the characters through the same camera transform, so the backdrop zooms with the scene (§6.2). The reference backdrops ([`assets/backdrops/`](../assets/backdrops), generated by `gen-backdrops.mjs`) are drawn well beyond the panel so an establishing pull-back never runs off the edge, and their ground line sits at the character ground line. Halos are a white, fattened copy of each sprite's strokes drawn underneath it — an outline that hugs the line art and needs no SVG filter, so it renders in any engine.

---

## §6.2 — Camera zoom

**Followed.** Each panel carries a `camera` — a rectangle of world space mapped onto the panel viewport (`computeCamera` in [`src/camera.ts`](../src/camera.ts)). It pulls in to the tightest shot the paper's three rules allow: never cut a character at the neck (include the shoulders), never let a required character be cut by the panel sides, never cut at the ankles (pull back to full body; knees are fine). Establishing shots — on a join, and every ~15 panels — pull back to show the surroundings. One line drives the whole design: "word balloons are unaffected by the virtual zoom factor," so the camera frames the character and background layer only, and a renderer draws balloons over the top in unscaled panel space.

The composer needs character proportions to apply the rules, so `compose` takes an optional `characterAssets` map of manifests (the extraction plan's original API, restored here). From each it reads the body aspect ratio (for horizontal extent) and the anatomical crop lines. Without it, a default humanoid is assumed and framing still works, just uniformly across the cast.

**Filled in — the vertical model.** The paper says "pull in as close as possible" and lists what not to cut, but not how the character sits in the frame. A landscape panel with balloons occupying the top cannot both show a large character *and* keep its head clear of the balloons if the frame is anchored to the head-top — the head ends up at the top of the panel, under the balloons. So the camera anchors the top of the head to a fixed screen line just below the balloon region, and lets magnification decide how far down the body the panel bottom cuts. The safe magnification range is a continuum — any crop between the knees and the shoulders — plus full body; the ankle zone in between is skipped, so rule 3 holds by construction. The tightest scale in that range that still fits the required characters horizontally (rule 2) and stays under a magnification ceiling wins. A cast too wide for even a full-body head-anchored shot switches to standing the characters on the ground and pulling back.

**Filled in — the numbers.** The paper gives none of these. The crop landmarks live on the manifest as an optional `framing: { shoulderFraction, kneeFraction }` (fractions of full height from the head-top), defaulting to a humanoid `0.22 / 0.78`; the reference character overrides them to match its big-headed proportions. The full standing height is a fraction of the panel (`characterHeightFraction`, default 0.82), the magnification ceiling is `maxZoom` (2.2), and the establishing pull-back is `establishingZoom` (0.85) — all tunable in `Rules`. The renderer must use the same `characterHeightFraction`, or the camera would crop in the wrong place; it is a `RenderOptions` field with the same default.

The coarse `zoom` label (`establishing` / `close` / `medium` / `wide`) is now derived from the camera's magnification and kept only for convenience and backward compatibility.

---

## Not implemented in v0.1

| Feature | Paper | Status |
|---|---|---|
| Shout balloons (§5.1) | jagged outline | Laid out identically to `speech`. The reference renderer draws the jagged outline; the paper notes these were unimplemented in the original. |
| Thought balloons (§5.1) | tail as a chain of ovals | Laid out, and drawn by the reference renderer with the oval-chain tail. |
| Semantic elements / Greek Chorus (§6.3) | keyword-triggered backdrop swaps, overlay objects, a commenting meta-character | Not started. Content-heavy and opt-in by design; a natural v0.2 extension point. |
| `.avb` character import | — | Deliberately out of scope. Legacy import belongs in a separate codec package, not on the critical path. |
