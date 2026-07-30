# Porting notes

Where this implementation follows Kurlander, Skelly & Salesin's SIGGRAPH '96 paper exactly, where it fills in detail the paper leaves unstated, and where it deliberately diverges.

Section numbers refer to [the paper](https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf). Note the paper's real numbering, which earlier drafts of this file got wrong: **§4.4** is *Rendering* (character composition and halos), **§6.1** is *Panel breaks*, **§6.2** is *Camera zoom* (establishing shots included), **§6.3** is *Semantic elements*.

Since Microsoft released the client's source at [github.com/microsoft/comic-chat](https://github.com/microsoft/comic-chat), there is a third thing to compare against: **what actually shipped**. It does not always match the paper, so divergences below are labelled against both. See [The program vs. the paper](#the-program-vs-the-paper).

---

## §4.1 — Gesture and expression inference

**Followed.** The trigger set is the paper's: emoticons, chat acronyms, all-caps, emphatic punctuation, sentence-start greetings and pronouns, and neutral-pose cycling when nothing fires.

**Resolved from the shipped source** (this was an open `TODO` until the C++ could be read). The paper mentions "a prioritization scheme to choose the most important gesture" without enumerating it. The client's rules were not code at all: they lived in localizable string resources (`v1.0/client/chat.rc` lines 1029–1043), parsed at startup by `textpose.cpp` into *matcher + argument + strength*, and priority was that numeric strength. `src/pose.ts` now has the same shape — `PoseRule { match, text, strength }` with `all-caps` / `find` / `word` / `start` matchers — and `SHIPPED_POSE_RULES` is that table transcribed:

| Strength | Cues |
|---|---|
| 11 | `ROTFL`, `LOL` (word) — plus `HEHE` from v2.1b |
| 10 | `:)` `:-)` `:(` `:-(` `;-)` — plus `;)` from v2.5 |
| 9 | ALL-CAPS, `!!!` |
| 8 | `are you`, `will you`, `did you`, `aren't you`, `don't you` (word, anywhere) |
| 7 | `i'm`, `i will`, `i'll`, `i am` (word, anywhere) |
| 5 / 3 / 2 | `Hello` `Welcome` `Howdy` / `Bye` / `Hi` (sentence start) |
| 4 / 3 | bare `You` / bare `I` (sentence start) |

Two consequences worth stating. Expression and gesture are filled **independently** from one strength-ordered candidate list — mirroring `GetBodyFromEmotion`, which pops candidates by descending strength and fills a face slot and a torso slot separately — so `"Are you OK? LOL"` laughs *and* points. And shouting at 9 sits *below* laughter and emoticons, so `"LOL THAT RULES"` gets a laughing face.

**Fixed against the paper and the program.** Two earlier readings were wrong:

- The multi-word phrase forms are matched as *words anywhere in the message*, not anchored to its start. The paper lists them separately from bare `You` for exactly this reason ("You (at beginning of sentence), are you, will you, …"), and the shipped table matches them with `CheckWord`. Anchoring them meant no ordinary question — `"how are you?"` — ever pointed, losing the gesture class the paper says "come[s] off well in comics".
- `start` rules fire at **every sentence start**, not just the message's. The client walked sentence boundaries (`GetNextSentenceStart`), so `"Well. I think so"` points at self.

**Extended.** `EXTRA_POSE_RULES` adds emoji, more emoticons, later acronyms (`ROFL`/`LMAO`/`IMHO`/`BRB`), more question openers, and casual greetings — at the shipped table's strength bands. It also adds rules for `angry`, `scared` and `bored`, which **no released version could trigger from text**: those three rule strings are empty in v1.0, v2.1b and v2.5 alike, so only the emotion wheel could ever set them. (A side effect, pinned in `test/pose.test.ts`: under the shipped table alone, `>:(` renders *sad*, because its `:(` tail matches the frown rule and nothing outranks it.)

**Extended — caps acronyms are not shouting.** A bare `LOL` or `OMG BRB` is stripped before the all-caps test, so it neither pulls a shouting face nor bursts the balloon. The original needed no such guard for the *face* (laughter's 11 beat all-caps' 9), but our §5.1 shout balloon does.

**Filled in.** The neutral-pose cycle advances only when nothing at all was inferred, since an expression now drives an emotional torso through `bodyForPose`. The original's `SetTorsoNeutral` likewise only ran when neither slot had been filled, and it too advanced round-robin from the last used pose.

---

## §4.3 — Character position and orientation

**Followed.** The scoring function and all six weights are the paper's, exposed as `rules.facingPenalties` — and they match the shipped `EvalPair` (`panel.cpp`) exactly, term for term:

| Condition | Weight |
|---|---|
| `a` addressed **nobody** and is not facing `b` | 4 |
| `a` addressed **nobody** and `b` is not facing `a` | 2 |
| `a` addressed `b` and `b` is not facing `a` | 4 |
| `a` addressed `b` and `a` is not facing `b` | **40** |
| per character between `a` and their addressee | 4 × n |
| per left/right **neighbour identity** change since the previous panel | 1 |

The greedy solver is also the paper's: place character 1 (1 slot × 2 facings), then character 2 (2 slots × 2 facings), and so on, keeping the lowest-scoring option at each step.

**Fixed — two terms had drifted from the paper.** Both were found auditing the code against the paper and confirmed against `EvalPair`:

1. *The "not addressed" test.* The first two weights are for a speaker who "has not addressed his utterance" — a general remark to the room, where facing anyone is fine. The code had tested "did not address **`b`**", which charged a speaker for turning away from every *bystander* of a directed line, pulling them round to face the crowd instead of committing to their addressee. Now the branch fires only when the speaker addressed nobody at all. Visible immediately in the golden fixture: a character thinking to herself while two others address her moves to the end of the row, where one facing takes in both — 8 points to 4.
2. *The Neighbors term.* The paper counts each of a character's left/right neighbours "that is different from the character last appearing there". The code had counted characters whose **x coordinate** moved. Because slots are spread evenly across the panel width, any change in cast size shifts every x at once — so the coordinate form fired uniformly for everyone and expressed no seating preference at all, precisely when a character joins or leaves and panel-to-panel stability matters most. Now it compares neighbour identity (ignoring neighbours who have themselves left the panel, which the seating cannot do anything about).

**Diverged — added a local search and an exhaustive pass.** The paper concedes its greedy "does an adequate job" without claiming optimality. Two failure modes showed up in testing:

1. Greedy fixes the first character's facing before any sibling exists to score against. That arbitrary choice can pin the panel into a layout where a speaker faces *away* from the character they addressed — the exact outcome the 40-point penalty exists to prevent.
2. Greedy seats characters in arrival order, so a bystander can end up standing between a speaker and their addressee. With three characters where `alice` addresses `cara`, greedy scored 10 against an optimum of 6 — the whole gap being the `addrBetweenFactor` term, which greedy cannot undo once the bystander is placed.

`placeCharacters` therefore accepts any facing flip or position swap that strictly improves the total, and then — for casts of five or fewer, which is every panel the composer builds, since the paper caps a panel at five — enumerates every seating and facing outright. Ties always keep the incumbent, so greedy's arrival-order seating and the previous panel's positions survive as tie-breakers, which is what stops characters shuffling between panels for no reason. Casts above five keep the greedy + local-search result, since the factorial search would be too expensive.

`test/placement.test.ts` brute-forces the optimum for casts of two through five and asserts the solver reaches it.

---

## §6.1 — Panel breaks

**Followed.** All four of the paper's break rules are implemented in `compose.ts` (`requiresBreakBefore` plus the layout-failure path), and they line up with the shipped `AddLine`:

- balloon layout fails for the panel → close it and retry the line in a fresh one; if it fails alone, split it (§5.2) and continue across panels;
- the five-character cap;
- one balloon per character per panel;
- a character already drawn cannot change expression within a panel (the information would be lost).

The 15% solo-panel roll on a first utterance "longer than a few words" (read as > 5 words) is the paper's too — see the program note below.

**Extended — an explicit break event.** `{ type: 'break' }` closes the panel wherever the author wants one. This is the client's `<Brk>` token, which it reached by converting an *empty message* into a break; `parse-log.ts` follows suit by emitting one for a blank line. It is the one bit of pacing control the composition rules cannot express.

**Extended — narration is exempt** from the one-balloon rule, so an action line and a spoken line by the same character can share a panel.

---

## §6.2 — Establishing shots

**Followed.** A wide, pulled-back shot orients the reader at the start and periodically thereafter (`rules.panelsBetweenEstablishingShots`, paper default ~15). The camera math is below.

**Diverged — establishing shots fold into the first line by default.** This is the clearest place the *composing* task departs from the *streaming* one. Comic Chat rendered a live stream: a `join` arrived as its own event with no text, so it could only become a standalone, dialogue-free panel. A composer sees the whole conversation at once and can open the way comics actually do — a wide shot that *also carries* the first line.

So `rules.establishingShots` is a policy knob (`src/types.ts`), defaulting to `fold`:

- **`fold`** (default) — the establishing frame attaches to the next line; the opening panel is a wide shot with dialogue, never blank. A folded establishing panel holds exactly that one opening line, then normal paneling resumes.
- **`per-join`** — the paper-literal behaviour: a standalone, empty establishing panel per join (and per periodic reminder).
- **`off`** — no establishing shots, join or periodic.

The scoring, placement, balloon routing and camera framing are untouched — only the establishing *cadence* changes, which is a presentation policy, not part of the paper's algorithms.

---

## §5.1 — Balloon kinds

**Followed.** Speech, thought, whisper and narration are the paper's kinds; the layout treats them uniformly (a narration box carries no tail, a thought balloon's tail is a separate oval chain at render time).

**Diverged — implemented `shout`.** The paper lists a shouting balloon as "yet to be implemented" in the original Comic Chat, so there is no reference behaviour to follow. Here `shout` lays out identically to `speech` and differs only in rendering (a jagged starburst outline in the reference SVG renderer). The composer also **auto-selects** it: a message with no explicit `kind` whose text reads as shouted — the same ALL-CAPS-or-`!!!` signals that make §4.1 pick the `shouting` expression (`isShoutText` in `src/pose.ts`) — becomes a shout balloon. An explicit `kind` (whisper/thought/…) always wins, and actions still narrate.

---

## §5.2 — Balloon layout

The most detailed algorithm in the paper, and the core of this library. `PlaceBalloons`, `MaxAllowable` and `ReduceChannel` are ported structurally, with the following notes. Both helpers are pinned against a port of the original C++ (`balloon.cpp`'s `QueryRoute`/`SetRoute`, via remsky/comic-chat-web) in [`test/balloons-crosscheck.test.ts`](../test/balloons-crosscheck.test.ts) — see the [implementation comparison](#appendix-comparison-with-other-reimplementations) below.

### `MaxAllowable` — the pseudocode can widen, the prose says trim

Published:

```
function MaxAllowable (Ri, xi, Rj, xj):
  R := Rj
  if xi < xj then  R.l := max{Ri.l + t, xi}
  else             R.r := min{Ri.r - t, xi}
  return R
```

Assigning `R.l` outright *widens* `Rj` whenever `max{Ri.l + t, xi}` falls left of the existing `Rj.l`. The surrounding prose is explicit that the operation only ever trims — "we trim the routing channel Rj just enough to ensure that…". The bound is folded in monotonically here — `max(Rj.l, max(Ri.l + t, xi))` — so the channel can only shrink while keeping the paper's inner `max`. (An earlier version of this port mistakenly weakened the inner `max` to a `min`; the cross-check against the C++ source caught it. The source computes exactly `max(Ri.l + t, xi)` and pushes the new channel clear of the prior speaker.)

### `ReduceChannel` — the pseudocode returns the wrong variable

Published:

```
function ReduceChannel (Ri, xi, Rj, xj)
  R := Ri
  if xi < xj then Ri.r := min{Ri.r, Rj.l}
  else            Ri.l := max{Ri.l, Rj.r}
  return R
```

It copies `Ri` into `R`, mutates `Ri`, then returns the unmutated `R`. The evident intent is to return the reduced interval, which is what this port does — and it matches the source's `SetRoute` exactly.

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

## §4.4 — Rendering: backdrops and halos

*(The paper's §4.4. Backdrops themselves have no numbered section; the halo/aura is described here and in §5.5.)*

**Renderer concern, supported by the schema and the reference renderer.** Comic Chat draws characters over a backdrop and gives each a white halo so it doesn't disappear into a busy background — the paper's Figure 3 makes the case starkly. The composer picks a backdrop id per scene and the manifest carries per-sprite `halo` bounds so that data travels with the art; the actual drawing is left to the renderer.

Backdrop selection (`chooseSceneBackdrop` in [`src/compose.ts`](../src/compose.ts)) picks **one** backdrop for the whole conversation, chosen once from the seeded RNG. The cast stays in one place — every panel, establishing shots included, shows the same setting — so a comic reads as one continuous scene rather than teleporting between rooms, and each seed is a consistent scene. The cast's `backdropPreferences` steer the choice: a backdrop ranked `r` (most-preferred first) scores `listLength - r`, summed across the cast, so a backdrop everyone reads well against wins; ties and the no-preference case fall to the seeded RNG. A caller that wants a specific room just passes a single-element `backdrops` array.

The reference renderer ([`examples/render-svg.ts`](../examples/render-svg.ts)) takes an optional `backdrops` map and draws the art panel-filling behind the characters, bottom-aligned so the scene's ground meets the characters' feet. The backdrop is *not* put through the camera transform: tying a flat scene image to the character zoom drifts the horizon and, on close-ups, frames a meaningless slice of it, so it stays fixed while the characters zoom.

Halos are the paper's aura, always on. The renderer dilates a character's *assembled* silhouette (`feMorphology`) and floods it white behind the art — one filter over the whole head+body group, so the aura is a single seamless shape rather than a per-part outline that rings at the neck. The dilation radius matches the ~4px aura baked into the original Comic Chat art, and because the filter sits inside the character's scale transform it rides the zoom, thickening on close-ups exactly as the original bitmap aura did. `feMorphology` is universally supported in browsers (the renderer's target); an SVG engine without it degrades gracefully to no halo.

---

## §6.2 — Camera zoom

**Followed.** Each panel carries a `camera` — a rectangle of world space mapped onto the panel viewport (`computeCamera` in [`src/camera.ts`](../src/camera.ts)). It pulls in to the tightest shot the paper's three rules allow: never cut a character at the neck (include the shoulders), never let a required character be cut by the panel sides, never cut at the ankles (pull back to full body; knees are fine). Establishing shots — on a join, and every ~15 panels — pull back to show the surroundings. One line drives the whole design: "word balloons are unaffected by the virtual zoom factor," so the camera frames the character and background layer only, and a renderer draws balloons over the top in unscaled panel space.

The composer needs character proportions to apply the rules, so `compose` takes an optional `characterAssets` map of manifests (the extraction plan's original API, restored here). From each it reads the body aspect ratio (for horizontal extent) and the anatomical crop lines. Without it, a default humanoid is assumed and framing still works, just uniformly across the cast.

**Filled in — the vertical model.** The paper says "pull in as close as possible" and lists what not to cut, but not how the character sits in the frame. A landscape panel with balloons occupying the top cannot both show a large character *and* keep its head clear of the balloons if the frame is anchored to the head-top — the head ends up at the top of the panel, under the balloons. So the camera anchors the top of the head to a fixed screen line just below the balloon region, and lets magnification decide how far down the body the panel bottom cuts. The safe magnification range is a continuum — any crop between the knees and the shoulders — plus full body; the ankle zone in between is skipped, so rule 3 holds by construction. The tightest scale in that range that still fits the required characters horizontally (rule 2) and stays under a magnification ceiling wins. A cast too wide for even a full-body head-anchored shot switches to standing the characters on the ground and pulling back.

**Filled in — the numbers.** The paper gives none of these. The crop landmarks live on the manifest as an optional `framing: { shoulderFraction, kneeFraction }` (fractions of full height from the head-top), defaulting to a humanoid `0.22 / 0.78`; the reference character overrides them to match its big-headed proportions. The full standing height is a fraction of the panel (`characterHeightFraction`, default 0.82), the magnification ceiling is `maxZoom` (2.2), and the establishing pull-back is `establishingZoom` (0.85) — all tunable in `Rules`. The renderer must use the same `characterHeightFraction`, or the camera would crop in the wrong place; it is a `RenderOptions` field with the same default.

The coarse `zoom` label (`establishing` / `close` / `medium` / `wide`) is now derived from the camera's magnification and kept only for convenience and backward compatibility.

---

## Character assets — layered and whole-figure

The paper's character model is a head and a body as **separate bitmaps that
combine freely**: any of the seven emotion heads on any gesture body, so a
modest set of drawings covers the whole expression × gesture matrix. That is a
manifest's `heads` + `bodies`, and the renderer composites the two at their
registration points.

Not every original character is built that way. Some — Tux, Waf, Connor,
Jordan and the rest of the `type == 1` avatars — are **whole-figure**: each pose
is a complete standing figure with the expression and gesture baked in and no
separable head. A manifest represents these with `figures` *instead of*
`heads`/`bodies`, one entry per pose keyed by an expression or gesture name.
`figureFor` (in [`src/manifest.ts`](../src/manifest.ts)) chooses a pose for the
composer's `(expression, gesture)` pair, preferring a matching gesture (a wave,
a point reads strongly at comic scale), then the expression, then `neutral`;
single-pose characters just always show their one figure. The composer is
oblivious to the distinction — it emits identity and geometry either way — and
only the renderer and `characterProportions` branch on it.

`.avb` import ([`tools/import-avb.py`](../tools/import-avb.py)) decodes both
kinds from Microsoft's binary avatar format into this manifest shape; the
committed PNGs and manifests are the deliverable, so the tool is rarely re-run.

---

## The program vs. the paper

Reading the released source settles a number of questions — and shows the paper describes a slightly *more* ambitious system than the one that shipped. Composition froze early: `panel.cpp` and `textpose.cpp` are byte-identical between the v1.0-pre and v1.0 snapshots (both August 1996), and functionally unchanged through v2.5-beta-1 (June 1998). Everything Microsoft added over those two years — IRCX, OLE automation and an ActiveX control, art packs, RTF input, file transfer, a bot rules engine — was protocol, UI, art and automation. The algorithm never moved.

**In the paper, never in the program.** These are implemented here from the paper, and are marked as such because the original client did not do them:

| Feature | Reality in the source |
|---|---|
| Shout balloons (§5.1) | Never shipped. `CBWoodringShout` is commented out in v1.0's `MakeBalloon` and gone by v2.5; the paper itself calls them unimplemented. A shouted line just got the shouting *face*. |
| Solo panels (§6.1) | No such roll exists. Every `randfloat()` in `panel.cpp` is balloon geometry or the title picker. |
| Periodic / per-join establishing shots (§6.2) | `Establishing()` returns true only for the **first panel or two of the whole comic** — no periodic re-establishing, no per-join shot. |
| The neck / ankle / knee crop rules (§6.2) | The shipped camera is ~15 lines: fit the width, then cap so a head cannot exceed `maxBodyHeight / 1.2` — the "don't cut at the neck" rule and nothing else. No knee or ankle logic, and establishing was zoom 1.0 rather than a pull-back below 1. |
| Text-based addressee detection (§4.2) | `FindAddressees` is commented out. Addressees came only from clicking a name in the UI. Our name-scanning (vocative position only) is an extension. |
| `angry` / `scared` / `bored` from text (§4.1) | Empty rule strings in every version — only the emotion wheel could set them. |

**In the program, and now adopted here.** Details the paper omits, taken from the source:

| Feature | Where it came from |
|---|---|
| Rule strengths and independent face/torso fill (§4.1) | `chat.rc` + `GetBodyFromEmotion` — see §4.1 above. |
| Sentence-start (not message-start) anchoring | `GetNextSentenceStart` in `textpose.cpp`. |
| Emotional torsos | Torso records carry expression poses, not just gestures; `bodyForPose` picks gesture → expression stance → cycling neutrals. See the character-assets section. |
| Wordless reactions, re-posed in place | `AddReaction` / `ReplaceBody` — a reaction by someone already in the panel does *not* break it. `{ type: 'reaction' }`. |
| Author-forced panel breaks | The `<Brk>` token, reached by sending an empty message. `{ type: 'break' }`; the log parser emits one per blank line. |
| The "starring" cast panel | `AddStars`, ordered by a per-avatar speech tally. `renderStripSvg(..., { credits: true })`. |
| Per-panel deterministic seeding | `m_seed = rand()` per panel, with `srand(m_seed)` before every draw — the same design as our `rng.ts`, independently arrived at. |

**Still in the program, not adopted.** Judged not worth the change, or worth a look later:

- **Listener-presence breaks.** `AvatarInPanel` checks whether the speaker is in the last panel *as a body at all* — so a silent listener who replies always starts a fresh panel. Adopting it would raise the panel count noticeably and shift the tuned pacing of seeded comics; our rule (same author already *spoke*) is looser and closer to the paper's wording.
- **Wider tail channels.** `MINROUTEWIDTH` is ~6.2% of panel width against our `minTailChannelWidth` ~3.5%.
- **Uniformly random balloon widths.** `GetCloudEstimate` draws the width uniformly between narrowest-feasible and full width; a knob to reach for if strips ever look too regular.

---

## Not implemented in v0.1

| Feature | Paper | Status |
|---|---|---|
| Thought balloons (§5.1) | tail as a chain of ovals | Laid out, and drawn by the reference renderer with the oval-chain tail. |
| Semantic elements / Greek Chorus (§6.3) | keyword-triggered backdrop swaps, overlay objects, a commenting meta-character | Not started. Content-heavy and opt-in by design; a natural v0.2 extension point. The one such hack in the shipped source (`semantic.cpp`) was a SIGGRAPH-demo easter egg, commented out of v2.5's `AddLine`. |
| Per-viewer views (§7) | whispers visible only to those involved; the join shot is per-recipient | Inherent to composing one shared view of a conversation. Whispers are drawn for everyone, and `per-join` establishing shots are per-join rather than per-viewer. |
| Emote intensity | the emotion wheel's radius | The builder captures it per row, but inference and the manifest ignore it. The original mapped fractional intensity onto per-intensity art records (with a `< 0.2` snap-to-neutral detente) — worth revisiting only when the asset set has per-intensity sprites. |

---

## Appendix: comparison with other reimplementations

After Microsoft open-sourced Comic Chat (July 2026), several independent reimplementations appeared. Two are useful reference points, because they take the *opposite* approach to this library and so make good oracles.

**[remsky/comic-chat-web](https://github.com/remsky/comic-chat-web)** is a line-by-line transcription of the original **C++** (`panel.cpp`, `balloon.cpp`), down to a hand-ported MSVC `rand()` for bit-exact output and TWIPS coordinates. Where this library reconstructs intent from the *paper* — and had to resolve the paper's ambiguous `MaxAllowable`/`ReduceChannel` pseudocode — remsky inherits the unambiguous source. That makes it ground truth for exactly those two spots:

- Their `SetRoute` matches our `reduceChannel` exactly.
- Their `QueryRoute` uses `max(Ri.l + t, xi)` and pushes the new channel clear of the prior speaker — which is what our `maxAllowable` now does, after the cross-check caught an inner `min` that should have been `max`.
- Their `pairRating` uses the same **40 / 4 / 2** facing weights as our `scorePair`, independently confirming the §4.3 numbers.

Their **camera** (`panel.cpp`) is *simpler* than the paper: `zoomFactor = unitWidth / sumWidth` capped by a head factor, snapped to 1 below 1.1×. The v1.0 source never implemented the paper's neck/ankle/knee caveats — so this library's §6.2 head-anchored model is actually closer to the paper's stated rules than the original code was. (Confirmed directly against the released source; see [The program vs. the paper](#the-program-vs-the-paper).)

**[gyng/comicchat](https://github.com/gyng/comicchat)** (the most-starred reimplementation, predating the open-sourcing) is a "quick and dirty" web app that approximates the look without the routing-channel algorithm.

`test/balloons-crosscheck.test.ts` encodes remsky's `QueryRoute`/`SetRoute` as an oracle and fuzzes our primitives against it, so any future drift is caught at the exact inputs.
