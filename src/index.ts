/**
 * comic-chat-composer — comic panel composition from a chat log.
 *
 * An independent open-source reimplementation of the panel-composition
 * algorithm described in:
 *
 *   David Kurlander, Tim Skelly and David Salesin,
 *   "Comic Chat", SIGGRAPH '96, pp. 225–236.
 *   https://kurlander.net/DJ/Pubs/SIGGRAPH96.pdf
 *
 * Written from the paper and the MIT-licensed source release at
 * https://github.com/microsoft/comic-chat. No code is copied from either.
 *
 * The library composes only — it produces a layout tree of panels, characters
 * and balloons, and never touches pixels. Rendering belongs downstream.
 */

export { compose, DEFAULT_RULES, DEFAULT_FACING_PENALTIES, type ComposeInput } from './compose.ts';

export { inferPose, type Pose, type InferPoseOptions } from './pose.ts';

export {
  placeCharacters,
  scorePlacement,
  type Placement,
  type PlaceCharactersOptions,
} from './placement.ts';

export {
  layoutBalloons,
  splitOversizedText,
  maxAllowable,
  reduceChannel,
  type Interval,
  type BalloonRequest,
  type LaidOutBalloon,
  type BalloonLayoutOptions,
  type BalloonLayoutResult,
} from './balloons.ts';

export {
  createApproximateMetrics,
  wrapText,
  widestWordWidth,
  measuredBlockWidth,
  splitIntoBalloonChunks,
  type FontMetrics,
  type ApproximateMetricsOptions,
} from './text.ts';

export { createRandom, randomBetween, type Random } from './rng.ts';

export {
  validateCharacterManifest,
  parseCharacterManifest,
  headForExpression,
  bodyForGesture,
  figureFor,
  isFigureManifest,
  isExpressive,
  characterProportions,
  DEFAULT_FRAMING,
  EMOTION_CODES,
  GESTURE_KEYS,
  type CharacterManifest,
  type CharacterFraming,
  type CharacterProportions,
  type HeadSprite,
  type BodySprite,
  type FigureSprite,
  type EmotionCode,
  type Point,
  type Bounds,
  type ValidationResult,
} from './manifest.ts';

export {
  computeCamera,
  type CameraCharacter,
  type CameraOptions,
} from './camera.ts';

export { isMessageEvent, isPresenceEvent } from './types.ts';

export type {
  BalloonKind,
  BalloonTail,
  Camera,
  CastEntry,
  ChatEvent,
  Expression,
  Facing,
  FacingPenalties,
  Gesture,
  MessageEvent,
  Panel,
  PanelBalloon,
  PanelCharacter,
  PresenceEvent,
  Rules,
  Zoom,
} from './types.ts';
