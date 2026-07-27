/**
 * The composer: turns a stream of chat events into a sequence of comic panels.
 *
 * This is an independent reimplementation of the panel-composition algorithm
 * described in Kurlander, Skelly & Salesin, "Comic Chat", SIGGRAPH '96
 * <https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf>.
 *
 * The composer is a pure function of the event stream plus a seed. That is a
 * property of the original design, not an accident of this port: each Comic
 * Chat client composed its own view of the conversation from the message
 * stream alone, with no server-side layout and nothing to reconcile between
 * clients. The same events, cast and seed always yield the same panels.
 *
 * Nothing here rasterises anything. The output is a layout tree — geometry and
 * identity — that a separate renderer consumes.
 */

import {
  layoutBalloons,
  splitOversizedText,
  type BalloonLayoutOptions,
  type BalloonRequest,
} from './balloons.ts';
import { computeCamera, type CameraCharacter } from './camera.ts';
import {
  bodyForGesture,
  characterProportions,
  DEFAULT_FRAMING,
  type CharacterManifest,
} from './manifest.ts';
import { placeCharacters, type Placement } from './placement.ts';
import { inferPose, isShoutText, type Pose } from './pose.ts';
import { createRandom, seededIndex, type Random } from './rng.ts';
import { createApproximateMetrics, type FontMetrics } from './text.ts';
import { isPresenceEvent } from './types.ts';
import type {
  BalloonKind,
  Camera,
  CastEntry,
  ChatEvent,
  Expression,
  FacingPenalties,
  MessageEvent,
  Panel,
  PanelBalloon,
  PanelCharacter,
  Rules,
  Zoom,
} from './types.ts';

/** Scoring weights stated in §4.3. */
export const DEFAULT_FACING_PENALTIES: FacingPenalties = {
  notAddrNotFacing: 4,
  notAddrOtherNotFacing: 2,
  addrOtherNotFacing: 4,
  addrNotFacing: 40,
  addrBetweenFactor: 4,
  neighborChange: 1,
};

/** Defaults drawn from the paper, with layout dimensions chosen for this port. */
export const DEFAULT_RULES: Rules = {
  maxCharactersPerPanel: 5,
  soloPanelProbability: 0.15,
  panelsBetweenEstablishingShots: 15,
  panelWidth: 400,
  panelHeight: 300,
  balloonRegionFraction: 0.55,
  minTailChannelWidth: 14,
  facingPenalties: DEFAULT_FACING_PENALTIES,
  characterHeightFraction: 0.82,
  maxZoom: 2.2,
  establishingZoom: 0.85,
};

export interface ComposeInput {
  events: readonly ChatEvent[];
  /** Which character art each participant uses. */
  cast: Record<string, CastEntry>;
  /** Backdrop ids to cycle through on establishing shots. */
  backdrops: readonly string[];
  rules?: Partial<Rules>;
  /**
   * Character manifests keyed by `characterId`. Optional: when provided, the
   * camera (§6.2) frames each panel from real character proportions — body
   * aspect ratio and anatomical crop lines. When omitted, a default humanoid
   * figure is assumed and framing still works, just uniformly.
   */
  characterAssets?: Record<string, CharacterManifest>;
  /** Text metrics for balloon layout. Defaults to a built-in approximation. */
  metrics?: FontMetrics;
  /** Seed for all layout randomness. Same seed → same panels. */
  seed?: number;
}

/** An utterance queued into the panel currently being built. */
interface PendingUtterance {
  author: string;
  text: string;
  kind: BalloonKind;
  pose: Pose;
  addressees: string[];
  continued: boolean;
}

interface PanelState {
  utterances: PendingUtterance[];
  /** Characters in this panel, in the order they entered it. */
  order: string[];
  addresseesOf: Map<string, string[]>;
  expressionOf: Map<string, Expression>;
  gestureOf: Map<string, PendingUtterance>;
  forceEstablishing: boolean;
  /** True once the solo-panel roll has been made for this panel. */
  soloRolled: boolean;
  /** True when this panel is locked to a single character. */
  solo: boolean;
}

function emptyPanelState(): PanelState {
  return {
    utterances: [],
    order: [],
    addresseesOf: new Map(),
    expressionOf: new Map(),
    gestureOf: new Map(),
    forceEstablishing: false,
    soloRolled: false,
    solo: false,
  };
}

function resolveRules(partial: Partial<Rules> | undefined): Rules {
  return {
    ...DEFAULT_RULES,
    ...partial,
    facingPenalties: {
      ...DEFAULT_FACING_PENALTIES,
      ...(partial?.facingPenalties ?? {}),
    },
  };
}

/**
 * Coarse framing label derived from the camera's magnification (§6.2). The
 * exact geometry lives in `panel.camera`; this is a convenience/compat summary.
 */
function zoomLabel(scale: number, establishing: boolean): Zoom {
  if (establishing) return 'establishing';
  if (scale >= 1.6) return 'close';
  if (scale >= 1.1) return 'medium';
  return 'wide';
}

/**
 * Pick the single backdrop a whole conversation plays out in. The cast stays in
 * one place for the length of the composition — every panel, establishing shots
 * included, shows the same setting — so a comic reads as one continuous scene
 * rather than teleporting between rooms. It is chosen once from the seeded RNG,
 * which makes each seed a consistent scene.
 *
 * The cast's `backdropPreferences` steer the choice: a backdrop ranked `r`
 * (0-based, most-preferred first) in a character's list scores `listLength - r`,
 * summed across the cast, so a backdrop everyone reads well against wins. Ties,
 * and the no-preference case, fall to a seed-keyed pick among the top scorers —
 * {@link seededIndex}, not the PRNG stream, so the scenes spread evenly across
 * the small sequential seeds people type rather than clustering.
 */
function chooseSceneBackdrop(
  characterIds: readonly string[],
  backdrops: readonly string[],
  characterAssets: Record<string, CharacterManifest> | undefined,
  seed: number,
): string {
  if (backdrops.length === 0) return 'default';
  if (backdrops.length === 1) return backdrops[0]!;

  const score = new Map<string, number>(backdrops.map((b) => [b, 0]));
  for (const cid of characterIds) {
    const prefs = characterAssets?.[cid]?.backdropPreferences;
    if (!prefs) continue;
    prefs.forEach((id, rank) => {
      if (score.has(id)) score.set(id, score.get(id)! + (prefs.length - rank));
    });
  }

  const best = Math.max(...score.values());
  const top = backdrops.filter((b) => score.get(b) === best);
  return top[seededIndex(seed, top.length)]!;
}

/**
 * Compose a chat log into comic panels.
 *
 * @example
 * ```ts
 * const panels = compose({
 *   events: [
 *     { type: 'join', author: 'alice', at: 0 },
 *     { type: 'message', author: 'alice', text: 'Hi Bob!', at: 1 },
 *   ],
 *   cast: { alice: { characterId: 'nib' } },
 *   backdrops: ['room'],
 *   seed: 1234,
 * });
 * ```
 *
 * @returns Panels in reading order. Each is a self-contained layout tree.
 */
export function compose(input: ComposeInput): Panel[] {
  const rules = resolveRules(input.rules);
  const metrics = input.metrics ?? createApproximateMetrics();
  const seed = input.seed ?? 42;
  const rand: Random = createRandom(seed);

  const balloonRegion = {
    top: metrics.lineHeight * 0.5,
    bottom: rules.panelHeight * rules.balloonRegionFraction,
  };

  const balloonOptions: BalloonLayoutOptions = {
    panelWidth: rules.panelWidth,
    region: balloonRegion,
    metrics,
    minTailChannelWidth: rules.minTailChannelWidth,
    rand,
  };

  const panels: Panel[] = [];
  const knownParticipants = new Set<string>();
  let previousPositions = new Map<string, number>();
  let panelsSinceEstablishing = 0;
  let state = emptyPanelState();

  // One backdrop for the whole conversation — the cast stays in one place.
  const sceneBackdrop = chooseSceneBackdrop(
    Object.values(input.cast).map((entry) => entry.characterId),
    input.backdrops,
    input.characterAssets,
    seed,
  );

  const groundY = rules.panelHeight;
  const characterHeight = rules.panelHeight * rules.characterHeightFraction;

  /** Frame a panel's characters with the virtual camera (§6.2). */
  const buildCamera = (characters: readonly PanelCharacter[], establishing: boolean): Camera => {
    // Every character the composer placed was included on purpose, so all of
    // them are "required" and must stay within the panel sides.
    const cameraCharacters: CameraCharacter[] = characters.map((c) => {
      const manifest = input.characterAssets?.[c.characterId];
      const proportions = manifest
        ? characterProportions(manifest)
        : { aspect: 0.5, ...DEFAULT_FRAMING };
      return {
        x: c.x,
        halfWidth: (characterHeight * proportions.aspect) / 2,
        required: true,
      };
    });

    // Crop at the shallowest shoulders and knees in the cast, so no one is cut
    // at the neck (rule 1) or the ankles (rule 3).
    let shoulderFraction = DEFAULT_FRAMING.shoulderFraction;
    let kneeFraction = DEFAULT_FRAMING.kneeFraction;
    for (const c of characters) {
      const manifest = input.characterAssets?.[c.characterId];
      const proportions = manifest ? characterProportions(manifest) : DEFAULT_FRAMING;
      shoulderFraction = Math.max(shoulderFraction, proportions.shoulderFraction);
      kneeFraction = Math.max(kneeFraction, proportions.kneeFraction);
    }

    return computeCamera(cameraCharacters, {
      panelWidth: rules.panelWidth,
      panelHeight: rules.panelHeight,
      characterHeight,
      groundY,
      shoulderFraction,
      kneeFraction,
      establishing,
      maxScale: rules.maxZoom,
      // Heads sit just below the balloon region, so balloons read as being
      // above them; the tails bridge the gap.
      headScreenY: balloonRegion.bottom,
      groundScreenY: rules.panelHeight - rules.panelHeight * 0.03,
      sideMargin: rules.panelWidth * 0.04,
      establishingScale: rules.establishingZoom,
    });
  };

  /**
   * Run character placement and balloon layout for a candidate panel.
   * Returns `null` when not every utterance could be placed.
   */
  const tryLayout = (
    candidate: PanelState,
  ): { placements: Placement[]; balloons: PanelBalloon[] } | null => {
    const placements = placeCharacters({
      authors: candidate.order,
      addresseesOf: candidate.addresseesOf,
      previousPositions,
      panelWidth: rules.panelWidth,
      penalties: rules.facingPenalties,
    });

    if (candidate.utterances.length === 0) return { placements, balloons: [] };

    const xOf = new Map(placements.map((p) => [p.author, p.x]));
    const requests: BalloonRequest[] = candidate.utterances.map((u) => ({
      speaker: u.author,
      // Already upper-cased at build time (§5.5), so layout and render agree.
      text: u.text,
      kind: u.kind,
      speakerX: xOf.get(u.author) ?? rules.panelWidth / 2,
      continued: u.continued,
    }));

    const result = layoutBalloons(requests, balloonOptions);
    if (result.placedCount < requests.length) return null;

    const balloons: PanelBalloon[] = result.balloons.map((b) => ({
      speaker: b.request.speaker,
      kind: b.request.kind,
      text: b.request.text,
      lines: b.lines,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      tail: b.tail,
      readingOrder: b.readingOrder,
      continued: b.request.continued ?? false,
    }));

    return { placements, balloons };
  };

  const flush = (): void => {
    if (state.utterances.length === 0 && !state.forceEstablishing) {
      state = emptyPanelState();
      return;
    }

    const laid = tryLayout(state);
    // `flush` is only reached with a state that laid out successfully when it
    // was accepted, so a null here means an establishing-only panel with no
    // balloons; fall back to placement alone.
    const placements =
      laid?.placements ??
      placeCharacters({
        authors: state.order,
        addresseesOf: state.addresseesOf,
        previousPositions,
        panelWidth: rules.panelWidth,
        penalties: rules.facingPenalties,
      });
    const balloons = laid?.balloons ?? [];

    const characters: PanelCharacter[] = placements.map((p) => {
      const utterance = state.gestureOf.get(p.author);
      return {
        author: p.author,
        characterId: input.cast[p.author]?.characterId ?? 'unknown',
        x: p.x,
        facing: p.facing,
        gesture: utterance?.pose.gesture ?? 'neutral',
        expression: state.expressionOf.get(p.author) ?? 'neutral',
      };
    });

    const camera = buildCamera(characters, state.forceEstablishing);
    const zoom = zoomLabel(camera.scale, state.forceEstablishing);

    panels.push({
      panelIndex: panels.length,
      zoom,
      camera,
      characters,
      balloons,
      backdrop: sceneBackdrop,
    });

    previousPositions = new Map(placements.map((p) => [p.author, p.x]));
    panelsSinceEstablishing = zoom === 'establishing' ? 0 : panelsSinceEstablishing + 1;
    state = emptyPanelState();
  };

  /** Clone just enough of a panel state to test a speculative addition. */
  const cloneState = (s: PanelState): PanelState => ({
    utterances: [...s.utterances],
    order: [...s.order],
    addresseesOf: new Map(s.addresseesOf),
    expressionOf: new Map(s.expressionOf),
    gestureOf: new Map(s.gestureOf),
    forceEstablishing: s.forceEstablishing,
    soloRolled: s.soloRolled,
    solo: s.solo,
  });

  const addToState = (s: PanelState, u: PendingUtterance): void => {
    if (!s.order.includes(u.author)) s.order.push(u.author);
    if (!s.solo) {
      for (const a of u.addressees) {
        if (!s.order.includes(a)) s.order.push(a);
      }
    }
    s.utterances.push(u);
    s.addresseesOf.set(u.author, u.addressees);
    s.expressionOf.set(u.author, u.pose.expression);
    s.gestureOf.set(u.author, u);
  };

  /**
   * Panel-break rules that can be decided without running layout (§4.4).
   * The layout-failure rule is handled separately, by trial.
   */
  const requiresBreakBefore = (u: PendingUtterance): boolean => {
    if (state.utterances.length === 0) return false;
    if (state.solo) return true;

    // One balloon per character per panel.
    if (state.utterances.some((p) => p.author === u.author && p.kind !== 'narration')) {
      return true;
    }

    // A character already drawn cannot change expression within a panel.
    const committed = state.expressionOf.get(u.author);
    if (committed !== undefined && committed !== u.pose.expression) return true;

    // Character cap.
    const incoming = new Set([...state.order, u.author, ...u.addressees]);
    if (incoming.size > rules.maxCharactersPerPanel) return true;

    return false;
  };

  const neutralVariantOf = new Map<string, number>();

  const buildUtterance = (
    msg: MessageEvent,
    text: string,
    continued: boolean,
  ): PendingUtterance => {
    const addressees =
      msg.addressees ??
      Object.keys(input.cast).filter(
        (name) =>
          name !== msg.author &&
          knownParticipants.has(name) &&
          new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(msg.text),
      );

    const pose = inferPose(msg.text, {
      expressionOverride: msg.expressionOverride,
      gestureOverride: msg.gestureOverride,
      previousNeutralVariant: neutralVariantOf.get(msg.author),
      neutralPoseCount: 3,
    });
    neutralVariantOf.set(msg.author, pose.neutralVariant);

    // Explicit kind wins; actions narrate; an unmarked message that reads as
    // shouted (ALL-CAPS or `!!!`) auto-promotes to a shout balloon (§5.1);
    // everything else is plain speech.
    const kind: BalloonKind =
      msg.kind ??
      (msg.type === 'action' ? 'narration' : isShoutText(msg.text) ? 'shout' : 'speech');
    // Comic Chat displays balloon text in all caps regardless of how it was
    // typed (§5.5). Apply that here — *after* inference, which needs the
    // original casing to detect ALL-CAPS shouting — so that text splitting,
    // balloon layout and rendering all measure the same (wider) capitals.
    // Deferring the upper-casing to render time made the splitter under-count
    // lines and silently drop oversized messages.
    return {
      author: msg.author,
      text: kind === 'narration' ? text : text.toUpperCase(),
      kind,
      pose,
      addressees,
      continued,
    };
  };

  const pushUtterance = (u: PendingUtterance): void => {
    if (requiresBreakBefore(u)) flush();

    // Solo-panel roll: on the first utterance of a panel, if it is more than a
    // few words long, there is a small chance of giving the speaker a panel to
    // themselves (§4.4).
    if (state.utterances.length === 0 && !state.soloRolled) {
      state.soloRolled = true;
      if (u.text.split(/\s+/).length > 5 && rand() < rules.soloPanelProbability) {
        state.solo = true;
      }
    }

    const candidate = cloneState(state);
    addToState(candidate, u);

    if (tryLayout(candidate) !== null) {
      state = candidate;
      return;
    }

    // Layout failed. If there is anything already in the panel, close it and
    // retry this utterance in a fresh panel.
    if (state.utterances.length > 0) {
      flush();
      const fresh = cloneState(state);
      addToState(fresh, u);
      if (tryLayout(fresh) !== null) {
        state = fresh;
        return;
      }
    }

    // The utterance does not fit even in a panel of its own: split it (§5.2).
    const chunks = splitOversizedText(u.text, balloonOptions);
    if (chunks.length <= 1) {
      // Cannot split further — accept it anyway rather than dropping speech.
      addToState(state, u);
      flush();
      return;
    }
    for (const chunk of chunks) {
      pushUtterance({ ...u, text: chunk, continued: true });
    }
  };

  for (const event of input.events) {
    if (isPresenceEvent(event)) {
      if (event.type === 'leave') {
        knownParticipants.delete(event.author);
        continue;
      }
      flush();
      knownParticipants.add(event.author);
      state.order.push(event.author);
      state.forceEstablishing = true;
      flush();
      continue;
    }

    knownParticipants.add(event.author);
    pushUtterance(buildUtterance(event, event.text, false));

    // Periodic establishing shot as a reminder of the setting (§4.4).
    if (panelsSinceEstablishing >= rules.panelsBetweenEstablishingShots) {
      flush();
      state.order = [...knownParticipants].slice(0, rules.maxCharactersPerPanel);
      state.forceEstablishing = true;
      flush();
    }
  }

  flush();
  return panels;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
