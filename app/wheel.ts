/**
 * The emotion wheel — mComic '96's signature control.
 *
 * Eight emotions sit around the rim, neutral at the centre. Press and drag: the
 * angle picks the emotion, the distance from centre is the intensity, and a
 * dead zone near the middle snaps back to neutral (the detente the original
 * client's body-cam used, `intensity < 0.2 → neutral`). It reports live while
 * you drag, so the speaker preview can emote in real time, and commits on
 * release.
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
}

export function createWheel(
  host: HTMLElement,
  onChange: (value: WheelValue) => void,
): WheelApi {
  const spokeMarks = SPOKES.map((s) => {
    const [x, y] = px(s.deg, R);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${s.color}" opacity="0.85"/>`;
  }).join('');

  host.innerHTML = `<svg viewBox="0 0 ${VB} ${VB}" role="slider" aria-label="Emotion wheel" tabindex="0">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#232334" stroke-width="2"/>
    ${spokeMarks}
    <circle id="w-center" cx="${CX}" cy="${CY}" r="9" fill="#15151f" stroke="#232334" stroke-width="1.5"/>
    <line id="w-stem" x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY}" stroke="#f2f0ff" stroke-width="2" opacity="0.5"/>
    <circle id="w-knob" cx="${CX}" cy="${CY}" r="11" fill="#f2f0ff" stroke="#08080b" stroke-width="2"/>
  </svg>`;

  const svg = host.querySelector('svg')!;
  const knob = host.querySelector<SVGCircleElement>('#w-knob')!;
  const stem = host.querySelector<SVGLineElement>('#w-stem')!;

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

  return {
    set: (v) => apply(v, false),
    value: () => value,
  };
}
