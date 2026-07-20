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

**Not ported.** The tail is emitted as `{ fromX, fromY, toX, toY, curve }` — endpoints and a direction, not a stroked path. Turning that into arcs, straight segments, or the chain of ovals a thought balloon needs is a rendering decision.

---

## §5.3 — Balloon body construction

**Not ported — rendering, not layout.** The paper's B-splines at tension 5.0, the two anti-amoeba rules (never dip inward on a per-line basis, respond only to large changes in the text outline) and the low-frequency perturbation of long flat segments all describe how to draw an outline around laid-out text. This library emits the text already broken into lines plus a bounding box; a renderer supplies the outline.

---

## §5.5 — Rendering

**Partly relevant.** One rule affects composition rather than drawing: balloon text is displayed in all caps regardless of how it was typed. That is applied here, to every balloon kind except `narration`. Halos, dashed whisper outlines and comic lettering are all renderer concerns; the manifest schema carries per-sprite halo bounds so that data travels with the art.

---

## Not implemented in v0.1

| Feature | Paper | Status |
|---|---|---|
| Zoom framing constraints (§4.4) | don't cut at the neck, include shoulders, prefer full body over cutting at the ankles, knees are acceptable | `zoom` is chosen from cast size and establishing-shot rules only. The constraint solver needs character bounding boxes; the manifest already carries `bounds` for it. |
| Shout balloons (§5.1) | jagged outline | Carried through layout identically to `speech`; expected to differ only at render time. The paper notes these were unimplemented in the original too. |
| Thought balloons (§5.1) | tail as a chain of ovals | The kind exists and lays out; the oval chain is a rendering concern. |
| Semantic elements / Greek Chorus (§6.3) | keyword-triggered backdrop swaps, overlay objects, a commenting meta-character | Not started. Content-heavy and opt-in by design; a natural v0.2 extension point. |
| `.avb` character import | — | Deliberately out of scope. Legacy import belongs in a separate codec package, not on the critical path. |
