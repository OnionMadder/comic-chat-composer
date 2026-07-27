/**
 * Core domain types for the comic panel composer.
 *
 * Terminology follows Kurlander, Skelly & Salesin, "Comic Chat", SIGGRAPH '96
 * <https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf>. Section references in this
 * file and elsewhere in `src/` point at that paper.
 */

/** Which way a character is turned within the panel. */
export type Facing = 'left' | 'right';

/**
 * Balloon varieties described in §5.1.
 *
 * `shout` is listed in the paper as "yet to be implemented" in the original
 * Comic Chat. Here it lays out identically to `speech` and differs only in
 * rendering (a jagged starburst). The composer auto-selects it for a message
 * whose text reads as shouted (ALL-CAPS or `!!!`) when no explicit kind is
 * given — the same emphatic signals that drive the `shouting` expression.
 */
export type BalloonKind = 'speech' | 'thought' | 'whisper' | 'shout' | 'narration';

/**
 * Facial expressions. The seven short codes used by the original character
 * art (`hap`/`laf`/`coy`/`neu`/`sad`/`ang`/`sho`) map onto the first seven
 * of these; `scared` and `bored` are named on the emotion wheel but have no
 * distinct sprite in the reference asset set.
 */
export type Expression =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'laughing'
  | 'shouting'
  | 'coy'
  | 'scared'
  | 'bored';

/** Body gestures inferred from message text (§4.1) or set explicitly. */
export type Gesture =
  | 'neutral'
  | 'wave'
  | 'point-self'
  | 'point-other'
  | 'smile'
  | 'shrug';

/** Camera framing for a panel (§4.4). */
export type Zoom = 'establishing' | 'wide' | 'medium' | 'close';

/** A message spoken (or acted) by a participant. */
export interface MessageEvent {
  type: 'message' | 'action';
  /** Participant identifier — a nickname, user id, whatever the caller uses. */
  author: string;
  text: string;
  /**
   * Who this message is directed at. When omitted, the composer infers
   * addressees by scanning the text for other participants' names.
   */
  addressees?: string[];
  /** Explicit expression, bypassing inference (the "emotion wheel" override). */
  expressionOverride?: Expression;
  /** Explicit gesture, bypassing inference. */
  gestureOverride?: Gesture;
  /** Force a balloon kind; otherwise derived from `type`. */
  kind?: BalloonKind;
  /** Monotonic ordering key. Not interpreted beyond ordering. */
  at: number;
}

/** A participant joining or leaving. Joins force an establishing shot (§4.4). */
export interface PresenceEvent {
  type: 'join' | 'leave';
  author: string;
  at: number;
}

export type ChatEvent = MessageEvent | PresenceEvent;

/**
 * Narrow a {@link ChatEvent} to a {@link MessageEvent}.
 *
 * Both members of the union carry a `type` that is itself a union of literals
 * (`'message' | 'action'` and `'join' | 'leave'`). TypeScript narrows the
 * `type` property in that situation but will not drop the constituent from the
 * parent union, so `if (e.type === 'join' || e.type === 'leave') continue;`
 * does not leave a `MessageEvent` behind. These guards do.
 */
export function isMessageEvent(event: ChatEvent): event is MessageEvent {
  return event.type === 'message' || event.type === 'action';
}

/** Narrow a {@link ChatEvent} to a {@link PresenceEvent}. See {@link isMessageEvent}. */
export function isPresenceEvent(event: ChatEvent): event is PresenceEvent {
  return event.type === 'join' || event.type === 'leave';
}

/** Maps a participant to the character art they use. */
export interface CastEntry {
  characterId: string;
}

/**
 * Weights for the character position/orientation scoring function (§4.3).
 *
 * The paper states these numbers directly. `addrNotFacing` is by far the
 * heaviest — it is what makes a speaker turn toward the person they are
 * addressing, and it dominates every other term.
 */
export interface FacingPenalties {
  /** `a` addressed nobody and is not facing `b`. Paper: 4. */
  notAddrNotFacing: number;
  /** `a` addressed nobody and `b` is not facing `a`. Paper: 2. */
  notAddrOtherNotFacing: number;
  /** `a` addressed `b` and `b` is not facing `a`. Paper: 4. */
  addrOtherNotFacing: number;
  /** `a` addressed `b` and `a` is not facing `b`. Paper: 40. */
  addrNotFacing: number;
  /** Per character standing between `a` and their addressee `b`. Paper: 4. */
  addrBetweenFactor: number;
  /** Per position change from the previous panel. Paper: 1. */
  neighborChange: number;
}

/** Tunable knobs. Every field has a default drawn from the paper. */
export interface Rules {
  /** Hard cap on characters in one panel. Paper: 5. */
  maxCharactersPerPanel: number;
  /** Chance of forcing a solo panel on a long opening utterance. Paper: 0.15. */
  soloPanelProbability: number;
  /** Panels between periodic establishing shots. Paper: ~15. */
  panelsBetweenEstablishingShots: number;
  /** Panel dimensions in abstract layout units (treat as px). */
  panelWidth: number;
  panelHeight: number;
  /**
   * Fraction of panel height, measured from the top, in which balloons may be
   * placed. The rest is character space. Paper: balloons sit above the tallest
   * character's head (§5.2).
   */
  balloonRegionFraction: number;
  /** Minimum horizontal width a routing channel must retain for its tail (§5.2, `t`). */
  minTailChannelWidth: number;
  facingPenalties: FacingPenalties;

  /** Full standing height of a character as a fraction of panel height (§6.2). */
  characterHeightFraction: number;
  /** Hard ceiling on camera magnification, so a solo close-up stays sane (§6.2). */
  maxZoom: number;
  /** Camera magnification for an establishing shot; below 1 pulls back (§6.2). */
  establishingZoom: number;
}

/** A character as placed in a composed panel. */
export interface PanelCharacter {
  author: string;
  characterId: string;
  /** Horizontal centre of the character's face. */
  x: number;
  facing: Facing;
  gesture: Gesture;
  expression: Expression;
}

/** A balloon tail, routed from balloon body down toward the speaker (§5.4). */
export interface BalloonTail {
  /** Where the tail leaves the balloon body. */
  fromX: number;
  fromY: number;
  /** Where the tail points — above the centre of the speaker's face. */
  toX: number;
  toY: number;
  /**
   * Curve direction. Tails starting left of the speaker curve counterclockwise,
   * tails starting right of the speaker curve clockwise (§5.4).
   */
  curve: 'cw' | 'ccw';
}

/** A balloon as placed in a composed panel. */
export interface PanelBalloon {
  speaker: string;
  kind: BalloonKind;
  /**
   * Balloon text. Comic Chat renders balloon text in all caps regardless of
   * how it was typed (§5.5) — the composer applies that here for every kind
   * except `narration`.
   */
  text: string;
  /** Text already broken into lines, centred at render time (§5.3). */
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** `null` for narration boxes, which have no tail. */
  tail: BalloonTail | null;
  /** 0-based reading order: top-down, then left-to-right at equal height. */
  readingOrder: number;
  /**
   * True when this balloon is one fragment of an utterance that was too long
   * to fit and had to be split across balloons, joined by ellipses (§5.2).
   */
  continued: boolean;
}

/**
 * A rectangle of world space mapped onto the panel viewport, framing the
 * character and background layer (§6.2). Balloons are drawn over the top in
 * unscaled panel coordinates — "word balloons are unaffected by the virtual
 * zoom factor". See {@link import('./camera.ts').Camera}.
 */
export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Magnification: `panelWidth / width`. */
  scale: number;
}

/** A fully composed panel: geometry and identity, no pixels. */
export interface Panel {
  panelIndex: number;
  /**
   * Coarse framing label, kept for convenience and backward compatibility.
   * Derived from {@link camera}: use `camera` for exact geometry.
   */
  zoom: Zoom;
  /** The virtual camera framing the character layer (§6.2). */
  camera: Camera;
  characters: PanelCharacter[];
  balloons: PanelBalloon[];
  backdrop: string;
}
