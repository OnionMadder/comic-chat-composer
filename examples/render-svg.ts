/**
 * A reference SVG renderer for composed panels.
 *
 * This lives in `examples/` on purpose. The composer is deliberately
 * render-agnostic — it emits geometry and identity, nothing else — so this is
 * one possible consumer of that output, not part of the library's API. Copy it,
 * adapt it, or replace it with a canvas/React/print renderer.
 *
 * What it does implement faithfully: balloon tails are spliced into the balloon
 * outline as a single path (so there is no seam where the tail meets the body),
 * thought balloons get a chain of ovals instead, whisper balloons get a dashed
 * outline over a white halo, and narration boxes are plain rectangles.
 *
 * What it does not: the paper's §5.3 balloon bodies are B-splines at tension
 * 5.0 fitted around the text outline, with anti-amoeba rules and low-frequency
 * perturbation. This uses rounded rectangles. That is the single biggest
 * visual gap between this renderer and real Comic Chat output.
 */

import type { BalloonTail, Panel, PanelBalloon, PanelCharacter } from '../src/types.ts';
import {
  bodyForGesture,
  headForExpression,
  type CharacterManifest,
} from '../src/manifest.ts';

/** Returns the inner markup of a sprite (everything inside its `<svg>` tag). */
export type SpriteResolver = (src: string) => string;

export interface RenderOptions {
  /** Character manifests, keyed by the `characterId` used in the cast. */
  characters: Record<string, CharacterManifest>;
  /** Resolves a manifest `src` to inline SVG markup. */
  sprite: SpriteResolver;
  panelWidth: number;
  panelHeight: number;
  /** Fill for the panel background. Backdrop art is out of scope here. */
  background?: string;
  /** Draw the balloon-region boundary and speaker labels. */
  debug?: boolean;
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Build the balloon outline as one path, splicing the tail into the bottom
 * edge so body and tail share a single continuous stroke.
 */
function balloonPath(b: PanelBalloon, tail: BalloonTail | null): string {
  const { x, y, width: w, height: h } = b;
  const r = Math.min(20, h / 2, w / 2);
  const bottom = y + h;

  const parts: string[] = [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${bottom}`,
  ];

  // Splice the tail into the bottom edge, which runs right-to-left.
  if (tail) {
    const mouth = Math.max(6, Math.min(14, w * 0.12));
    const cx = Math.min(Math.max(tail.fromX, x + r + mouth), x + w - r - mouth);
    const right = cx + mouth;
    const left = cx - mouth;

    // Bow the two sides of the tail the same way the composer routed it.
    const bow = tail.curve === 'ccw' ? -1 : 1;
    const midY = (bottom + tail.toY) / 2;
    const ctrlRight = `${right + bow * 6} ${midY}`;
    const ctrlLeft = `${left + bow * 10} ${midY}`;

    parts.push(`H ${right}`);
    parts.push(`Q ${ctrlRight} ${tail.toX} ${tail.toY}`);
    parts.push(`Q ${ctrlLeft} ${left} ${bottom}`);
  }

  parts.push(`H ${x + r}`);
  parts.push(`A ${r} ${r} 0 0 1 ${x} ${bottom - r}`);
  parts.push(`V ${y + r}`);
  parts.push(`A ${r} ${r} 0 0 1 ${x + r} ${y}`);
  parts.push('Z');
  return parts.join(' ');
}

/** Jagged outline for shout balloons (§5.1). */
function shoutPath(b: PanelBalloon): string {
  const { x, y, width: w, height: h } = b;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const spikes = Math.max(12, Math.round(w / 14));
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const t = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const scale = i % 2 === 0 ? 1 : 0.82;
    pts.push(`${cx + Math.cos(t) * (w / 2) * scale} ${cy + Math.sin(t) * (h / 2) * scale}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

function renderBalloon(b: PanelBalloon, lineHeight: number): string {
  const out: string[] = [];
  const stroke = '#111';
  const centreX = b.x + b.width / 2;

  if (b.kind === 'narration') {
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#fff" stroke="${stroke}" stroke-width="2"/>`,
    );
  } else if (b.kind === 'thought') {
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${Math.min(24, b.height / 2)}" fill="#fff" stroke="${stroke}" stroke-width="2"/>`,
    );
    if (b.tail) {
      // Tail as a chain of shrinking ovals rather than a solid taper.
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1);
        const ox = b.tail.fromX + (b.tail.toX - b.tail.fromX) * t;
        const oy = b.y + b.height + (b.tail.toY - (b.y + b.height)) * t;
        const rr = 6 * (1 - t) + 2;
        out.push(
          `<ellipse cx="${ox}" cy="${oy}" rx="${rr * 1.2}" ry="${rr}" fill="#fff" stroke="${stroke}" stroke-width="2"/>`,
        );
      }
    }
  } else if (b.kind === 'shout') {
    out.push(`<path d="${shoutPath(b)}" fill="#fff" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    if (b.tail) {
      out.push(
        `<path d="M ${b.tail.fromX} ${b.y + b.height} L ${b.tail.toX} ${b.tail.toY}" fill="none" stroke="${stroke}" stroke-width="2"/>`,
      );
    }
  } else {
    const d = balloonPath(b, b.tail);
    // Whisper balloons get a white halo under a dashed outline (§5.1, §5.5).
    if (b.kind === 'whisper') {
      out.push(`<path d="${d}" fill="#fff" stroke="#fff" stroke-width="7"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-dasharray="5 4"/>`);
    } else {
      out.push(`<path d="${d}" fill="#fff" stroke="${stroke}" stroke-width="2"/>`);
    }
  }

  const italic = b.kind === 'whisper' ? ' font-style="italic"' : '';
  const weight = b.kind === 'shout' ? ' font-weight="bold"' : '';
  const lines = b.lines.length > 0 ? b.lines : [b.text];
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = b.y + (b.height - blockHeight) / 2 + lineHeight * 0.78;

  lines.forEach((line, i) => {
    out.push(
      `<text x="${centreX}" y="${firstBaseline + i * lineHeight}" text-anchor="middle"` +
        ` font-family="'Comic Sans MS', 'Comic Neue', cursive" font-size="${lineHeight * 0.78}"` +
        `${italic}${weight} fill="#111">${escapeXml(line)}</text>`,
    );
  });

  return out.join('\n');
}

function renderCharacter(
  c: PanelCharacter,
  options: RenderOptions,
  groundY: number,
): string {
  const manifest = options.characters[c.characterId];
  if (!manifest) return '';

  const body = bodyForGesture(manifest, c.gesture);
  const head = headForExpression(manifest, c.expression);

  // Place the body so the head's face centre lands on the composer's `x`, then
  // place the head so its `attach` meets the body's `headAttach`.
  const bodyX = c.x - body.headAttach.x + head.attach.x - head.tailAnchor.x;
  const bodyY = groundY - body.bounds.height;
  const headX = bodyX + body.headAttach.x - head.attach.x;
  const headY = bodyY + body.headAttach.y - head.attach.y;

  // Facing is a horizontal mirror about the character's own x.
  const flip = c.facing === 'left' ? ` transform="translate(${2 * c.x},0) scale(-1,1)"` : '';

  return `<g${flip}>
  <g transform="translate(${bodyX},${bodyY})">${options.sprite(body.src)}</g>
  <g transform="translate(${headX},${headY})">${options.sprite(head.src)}</g>
</g>`;
}

/**
 * Render one panel to a standalone `<svg>` string.
 *
 * @example
 * ```ts
 * const svg = renderPanelToSvg(panels[0], {
 *   characters: { nib },
 *   sprite: (src) => spriteMarkup[src],
 *   panelWidth: 400,
 *   panelHeight: 300,
 * });
 * ```
 */
export function renderPanelToSvg(panel: Panel, options: RenderOptions): string {
  const { panelWidth: w, panelHeight: h } = options;
  const lineHeight = 15;
  const groundY = h - 8;
  const parts: string[] = [];

  parts.push(
    `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="${options.background ?? '#fdfdf8'}" stroke="#111" stroke-width="3"/>`,
  );

  if (options.debug) {
    parts.push(
      `<line x1="0" y1="${h * 0.55}" x2="${w}" y2="${h * 0.55}" stroke="#ccc" stroke-dasharray="4 4"/>`,
    );
  }

  for (const c of panel.characters) parts.push(renderCharacter(c, options, groundY));

  // Reading order determines paint order, so later balloons overlap earlier
  // ones rather than the other way round.
  const ordered = [...panel.balloons].sort((a, b) => a.readingOrder - b.readingOrder);
  for (const b of ordered) parts.push(renderBalloon(b, lineHeight));

  if (options.debug) {
    for (const c of panel.characters) {
      parts.push(
        `<text x="${c.x}" y="${h - 3}" font-size="9" text-anchor="middle" fill="#999">${escapeXml(c.author)}</text>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${parts.join('\n')}
</svg>`;
}

/** Render every panel to a single SVG string per panel. */
export function renderPanelsToSvg(panels: readonly Panel[], options: RenderOptions): string[] {
  return panels.map((p) => renderPanelToSvg(p, options));
}
