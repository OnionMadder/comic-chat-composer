/**
 * The emotion wheel — mComic '96's signature control.
 *
 * Eight emotions sit around the rim, neutral at the centre. Press and drag: the
 * angle picks the emotion, the distance from centre is the intensity, and a
 * dead zone near the middle snaps back to neutral (the detente the original
 * client's body-cam used, `intensity < 0.2 → neutral`). It reports live while
 * you drag, so the speaker preview can emote in real time, and commits on
 * release.
 *
 * Each rim node is a **pose thumbnail** — the active speaker actually striking
 * that emotion (head-and-torso crop, gesture pinned to neutral so the
 * emotion's own stance shows). Picking a look is matching a face, not
 * translating a vocabulary. Thumbs are cached per character, and the knob is
 * the only thing that moves during a drag, so dragging never rebuilds nine
 * rendered panels. Without a thumb source the wheel falls back to the
 * coloured dots it always had.
 */

import type { Expression } from '../src/types.ts';

export type WheelEmotion = Expression | 'neutral';

interface Spoke {
  name: Exclude<WheelEmotion, 'neutral'>;
  deg: number; // 0 = up, clockwise
  color: string;
}

// Positive up, loud on the right, low/negative around the bottom and left.
const SPOKES: Spoke[] = [
  { name: 'happy', deg: 0, color: '#b6ff3d' },
  { name: 'laughing', deg: 45, color: '#2cffe6' },
  { name: 'coy', deg: 90, color: '#ff3d9a' },
  { name: 'shouting', deg: 135, color: '#ffc61a' },
  { name: 'angry', deg: 180, color: '#ff5555' },
  { name: 'sad', deg: 225, color: '#5b8cff' },
  { name: 'scared', deg: 270, color: '#b57bff' },
  { name: 'bored', deg: 315, color: '#8b87a6' },
];

const VB = 120;
const CX = 60;
const CY = 60;
const R = 46; // rim radius, in viewBox units
const DEAD = 0.2; // intensity below this reads as neutral
const THUMB_R = 13; // pose-thumbnail radius at the rim
const CENTER_R = 14; // neutral thumbnail, at the centre

const rad = (deg: number): number => (deg * Math.PI) / 180;
const px = (deg: number, r: number): [number, number] => [CX + Math.sin(rad(deg)) * r, CY - Math.cos(rad(deg)) * r];

export interface WheelValue {
  emotion: WheelEmotion;
  intensity: number;
}

export interface WheelApi {
  /** Move the knob to a value without firing onChange (e.g. a reset). */
  set(value: WheelValue): void;
  value(): WheelValue;
  /** Point the pose thumbnails at a character. Rebuilds only on change. */
  setCharacter(characterId: string | null): void;
}

export interface WheelOptions {
  /**
   * Render `characterId` striking `emotion`, as a full standalone panel SVG
   * (the same renderer the speaker preview uses). The wheel crops it to a
   * head-and-torso coin itself. Optional — without it the wheel keeps its
   * labelled dots.
   */
  thumbSvg?: (characterId: string, emotion: WheelEmotion) => string;
}

/**
 * Re-tag a full preview panel as a nested crop: the head-and-shoulders band,
 * where a layered head swap and a whole-figure stance change are both visible
 * at coin size.
 *
 * The window is a fixed fraction rather than a per-character measurement
 * because it can be: the preview stands every character on the panel floor at
 * `characterHeightFraction`, so the top of the figure lands at the same y for
 * all 31 of them. Measured at 0.72, the figure starts at 28% of the panel
 * height — the window opens just above that and runs a third of the panel
 * down, which is head-and-shoulders on a layered character and the expressive
 * top third of a whole-figure one.
 */
function cropToCoin(svg: string, cx: number, cy: number, r: number): string {
  const tag = /^<svg\b[^>]*?width="(\d+(?:\.\d+)?)"[^>]*?height="(\d+(?:\.\d+)?)"[^>]*>/.exec(svg);
  if (!tag) return '';
  const w = Number(tag[1]!);
  const h = Number(tag[2]!);
  const side = h * 0.33;
  const x0 = w / 2 - side / 2;
  const y0 = h * 0.26;
  return (
    `<svg x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${r * 2}" height="${r * 2}"` +
    ` viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}"` +
    ` preserveAspectRatio="xMidYMid slice">` +
    svg.slice(tag[0].length)
  );
}

export function createWheel(
  host: HTMLElement,
  onChange: (value: WheelValue) => void,
  options: WheelOptions = {},
): WheelApi {
  // The thumbs are the expensive part — nine rendered panels — and they depend
  // only on the character. Cache the assembled markup per character so speaker
  // changes are instant after the first look at each cast member.
  const thumbCache = new Map<string, string>();
  let characterId: string | null = null;

  function thumbLayer(id: string): string {
    const hit = thumbCache.get(id);
    if (hit !== undefined) return hit;
    const parts: string[] = [];
    const coin = (emotion: WheelEmotion, cx: number, cy: number, r: number, key: string): void => {
      const svg = options.thumbSvg!(id, emotion);
      const cropped = cropToCoin(svg, cx, cy, r);
      if (!cropped) return;
      parts.push(
        `<clipPath id="wt-${key}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/></clipPath>`,
        `<g clip-path="url(#wt-${key})"><title>${emotion}</title>${cropped}</g>`,
      );
    };
    SPOKES.forEach((s, i) => {
      const [x, y] = px(s.deg, R);
      coin(s.name, x, y, THUMB_R, String(i));
    });
    coin('neutral', CX, CY, CENTER_R, 'c');
    // A coloured ring over each coin keeps the wheel's colour language: the
    // ring is the same hue the knob takes when that emotion is active.
    SPOKES.forEach((s) => {
      const [x, y] = px(s.deg, R);
      parts.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${THUMB_R + 0.5}" fill="none" stroke="${s.color}" stroke-width="1.5" opacity="0.85"/>`,
      );
    });
    parts.push(
      `<circle cx="${CX}" cy="${CY}" r="${CENTER_R + 0.5}" fill="none" stroke="#232334" stroke-width="1.5"/>`,
    );
    const out = parts.join('');
    thumbCache.set(id, out);
    return out;
  }

  /** The wheel's structure: rim + nodes. Rebuilt only when the character changes. */
  function build(): void {
    const canThumb = Boolean(options.thumbSvg && characterId);
    const nodes = canThumb
      ? thumbLayer(characterId!)
      : SPOKES.map((s) => {
          const [x, y] = px(s.deg, R);
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${s.color}" opacity="0.85"/>`;
        }).join('') +
        `<circle cx="${CX}" cy="${CY}" r="9" fill="#15151f" stroke="#232334" stroke-width="1.5"/>`;

    host.innerHTML = `<svg viewBox="0 0 ${VB} ${VB}" role="slider" aria-label="Emotion wheel" tabindex="0">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#232334" stroke-width="2"/>
      ${nodes}
      <line id="w-stem" x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY}" stroke="#f2f0ff" stroke-width="2" opacity="0.5"/>
      <circle id="w-knob" cx="${CX}" cy="${CY}" r="${canThumb ? 8 : 11}" fill="#f2f0ff" stroke="#08080b" stroke-width="2"/>
    </svg>`;
    wire();
    // Restore the knob to the current value on rebuild.
    apply(value, false);
  }

  let svg: SVGSVGElement;
  let knob: SVGCircleElement;
  let stem: SVGLineElement;

  let value: WheelValue = { emotion: 'neutral', intensity: 0 };

  const nearest = (deg: number): Spoke => SPOKES[Math.round(deg / 45) % 8]!;

  const place = (deg: number, intensity: number): void => {
    const r = intensity * R;
    const [x, y] = px(deg, r);
    knob.setAttribute('cx', x.toFixed(1));
    knob.setAttribute('cy', y.toFixed(1));
    stem.setAttribute('x2', x.toFixed(1));
    stem.setAttribute('y2', y.toFixed(1));
    const color = intensity < DEAD ? '#f2f0ff' : nearest(deg).color;
    knob.setAttribute('fill', color);
  };

  const apply = (v: WheelValue, fire: boolean): void => {
    value = v;
    const deg = v.emotion === 'neutral' ? 0 : SPOKES.find((s) => s.name === v.emotion)!.deg;
    place(deg, v.emotion === 'neutral' ? 0 : Math.max(DEAD, v.intensity));
    svg.setAttribute('aria-valuetext', v.emotion);
    if (fire) onChange(v);
  };

  const fromPoint = (clientX: number, clientY: number): WheelValue => {
    const rect = svg.getBoundingClientRect();
    const ux = ((clientX - rect.left) / rect.width) * VB;
    const uy = ((clientY - rect.top) / rect.height) * VB;
    const dx = ux - CX;
    const dy = uy - CY;
    const dist = Math.hypot(dx, dy);
    const intensity = Math.min(1, dist / R);
    if (intensity < DEAD) return { emotion: 'neutral', intensity: 0 };
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return { emotion: nearest(deg).name, intensity };
  };

  let dragging = false;
  const drag = (e: PointerEvent): void => {
    if (!dragging) return;
    const v = fromPoint(e.clientX, e.clientY);
    const deg = v.emotion === 'neutral' ? 0 : SPOKES.find((s) => s.name === v.emotion)!.deg;
    place(deg, v.emotion === 'neutral' ? 0 : v.intensity);
    value = v;
    svg.setAttribute('aria-valuetext', v.emotion);
    onChange(v);
  };

  function wire(): void {
    svg = host.querySelector('svg')!;
    knob = host.querySelector<SVGCircleElement>('#w-knob')!;
    stem = host.querySelector<SVGLineElement>('#w-stem')!;
    svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      drag(e);
    });
    svg.addEventListener('pointermove', drag);
    svg.addEventListener('pointerup', (e) => {
      dragging = false;
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    });
  }

  build();

  return {
    set: (v) => apply(v, false),
    value: () => value,
    setCharacter: (id) => {
      if (id === characterId) return;
      characterId = id;
      build();
    },
  };
}
