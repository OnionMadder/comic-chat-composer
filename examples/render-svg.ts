/**
 * A reference SVG renderer for composed panels.
 *
 * This lives in `examples/` on purpose. The composer is deliberately
 * render-agnostic — it emits geometry and identity, nothing else — so this is
 * one possible consumer of that output, not part of the library's API. Copy it,
 * adapt it, or replace it with a canvas/React/print renderer.
 *
 * Balloon bodies come from `balloon-shape.ts`, which implements the paper's
 * §5.3 construction: a closed B-spline fitted around the text at tension 5.0,
 * with both anti-amoeba rules and low-frequency perturbation. Tails are spliced
 * into that same spline, so body and tail share one continuous outline with no
 * seam. Thought balloons get a chain of ovals instead, whisper balloons get a
 * dashed outline over a white halo, and narration boxes are plain rectangles.
 *
 * Backdrops (optional) are drawn behind the characters through the same camera
 * transform, so the whole scene zooms together (§6.2). Each character gets a
 * white halo so it reads against a busy backdrop (§6.1).
 */

import type { Panel, PanelBalloon, PanelCharacter } from '../src/types.ts';
import {
  bodyForGesture,
  headForExpression,
  figureFor,
  isFigureManifest,
  type CharacterManifest,
} from '../src/manifest.ts';
import { createApproximateMetrics, type FontMetrics } from '../src/text.ts';
import { balloonOutlinePath } from './balloon-shape.ts';

/**
 * Returns the markup for a sprite: the inner SVG for a vector sprite, or an
 * `<image>` for a raster one. `characterId` is passed because sprite filenames
 * (`head-neu.png`, …) repeat across characters, so the resolver must namespace
 * by character.
 */
export type SpriteResolver = (src: string, characterId: string) => string;

export interface RenderOptions {
  /** Character manifests, keyed by the `characterId` used in the cast. */
  characters: Record<string, CharacterManifest>;
  /** Resolves a manifest `src` to inline SVG markup. */
  sprite: SpriteResolver;
  panelWidth: number;
  panelHeight: number;
  /** Flat fill shown when a panel's backdrop has no art. */
  background?: string;
  /**
   * Backdrop art keyed by id, as inline SVG markup in world coordinates (the
   * composer's 400×300 panel space, ground at the panel bottom). Drawn behind
   * the characters and through the same camera transform, so the scene zooms
   * with them (§6.2). Ids come from the composer's `backdrop` field.
   */
  backdrops?: Record<string, string>;
  /** Draw the balloon-region boundary and speaker labels. */
  debug?: boolean;
  /**
   * Metrics used to measure line widths when fitting the balloon outline.
   * Should match whatever the composer laid the text out with, or the outline
   * will not agree with the text inside it.
   */
  metrics?: FontMetrics;
  /**
   * Full standing character height as a fraction of panel height. Must match
   * the composer's `characterHeightFraction` rule (default 0.82), or the camera
   * will crop characters in the wrong place.
   */
  characterHeightFraction?: number;
}

/** Halo dilation in sprite pixels — matches the original Comic Chat aura (§6.1). */
const HALO_RADIUS = 4;

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Fit the §5.3 spline outline around a balloon's laid-out text.
 *
 * The composer gives a bounding box and the text already broken into lines;
 * this measures those lines and hands them to the shape builder, which does the
 * margin expansion, anti-amoeba smoothing, perturbation and tail splicing.
 */
function balloonPath(
  b: PanelBalloon,
  lineHeight: number,
  metrics: FontMetrics,
  spliceTail: boolean,
): string {
  const lines = b.lines.length > 0 ? b.lines : [b.text];
  const measured = lines.map((line) => metrics.measure(line));
  const blockHeight = lines.length * lineHeight;
  const margin = Math.max(6, lineHeight * 0.55);

  // The outline follows the *relative* contour of the lines, but the absolute
  // scale comes from the composer's box. Measured widths are only an estimate —
  // whatever font actually renders will differ — and an outline fitted to an
  // underestimate leaves the text hanging outside the balloon. The composer
  // already wrapped these lines to fit `b.width`, so normalising the widest
  // line to that box keeps the shape while guaranteeing the text fits.
  const widest = Math.max(...measured, 1);
  const target = Math.max(1, b.width - margin * 2);
  const scale = target / widest;

  return balloonOutlinePath({
    lineWidths: measured.map((w) => w * scale),
    centreX: b.x + b.width / 2,
    textTop: b.y + (b.height - blockHeight) / 2,
    lineHeight,
    margin,
    tail: spliceTail ? b.tail : null,
  });
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

function renderBalloon(b: PanelBalloon, lineHeight: number, metrics: FontMetrics): string {
  const out: string[] = [];
  const stroke = '#111';
  const centreX = b.x + b.width / 2;

  if (b.kind === 'narration') {
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#fff" stroke="${stroke}" stroke-width="2"/>`,
    );
  } else if (b.kind === 'thought') {
    // Same spline body, but no tail spliced in — a thought balloon's tail is a
    // separate chain of ovals.
    out.push(
      `<path d="${balloonPath(b, lineHeight, metrics, false)}" fill="#fff" stroke="${stroke}" stroke-width="2"/>`,
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
    const d = balloonPath(b, lineHeight, metrics, true);
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

  // The balloon outline is fitted to `metrics`, which is an estimate — whatever
  // font actually resolves will be wider or narrower, and then the text spills
  // outside the balloon that was drawn to hold it. `textLength` pins each line
  // to exactly the width it was measured at, so outline and glyphs agree in any
  // font and any environment. This is why the renderer must be given the same
  // metrics the composer wrapped the text with.
  const widths = lines.map((line) => metrics.measure(line));
  const widest = Math.max(...widths, 1);
  const target = Math.max(1, b.width - Math.max(6, lineHeight * 0.55) * 2);
  const scale = target / widest;

  lines.forEach((line, i) => {
    const length = widths[i]! * scale;
    out.push(
      `<text x="${centreX}" y="${firstBaseline + i * lineHeight}" text-anchor="middle"` +
        ` textLength="${length.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` +
        ` font-family="'Comic Sans MS', 'Comic Neue', cursive" font-size="${lineHeight * 0.78}"` +
        `${italic}${weight} fill="#111">${escapeXml(line)}</text>`,
    );
  });

  return out.join('\n');
}

/**
 * Render a whole-figure character: one sprite per pose, chosen by expression
 * and gesture, scaled so the full figure is `characterHeight` tall with its
 * feet on the ground and its face centre on the composer's `x`.
 */
function renderFigure(
  c: PanelCharacter,
  manifest: CharacterManifest,
  options: RenderOptions,
  groundY: number,
  characterHeight: number,
  haloId: string,
): string {
  const figure = figureFor(manifest, c.expression, c.gesture);
  const scale = characterHeight / figure.bounds.height;
  const tx = c.x - scale * figure.tailAnchor.x;
  const ty = groundY - scale * figure.bounds.height;
  const flip = c.facing === 'left' ? `translate(${2 * c.x},0) scale(-1,1) ` : '';

  const markup = options.sprite(figure.src, c.characterId);

  return `<g transform="${flip}translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(4)})">
  <g filter="url(#${haloId})">${markup}</g>
</g>`;
}

function renderCharacter(
  c: PanelCharacter,
  options: RenderOptions,
  groundY: number,
  characterHeight: number,
  haloId: string,
): string {
  const manifest = options.characters[c.characterId];
  if (!manifest) return '';

  if (isFigureManifest(manifest)) {
    return renderFigure(c, manifest, options, groundY, characterHeight, haloId);
  }

  const body = bodyForGesture(manifest, c.gesture);
  const head = headForExpression(manifest, c.expression);

  // Head sits on the body where its `attach` meets the body's `headAttach`.
  // In body-sprite coordinates (body top-left at the origin) that puts the head
  // at this offset, and the head reaches this far above the body's top edge.
  const headDx = body.headAttach.x - head.attach.x;
  const headDy = body.headAttach.y - head.attach.y;
  const overhang = Math.max(0, -headDy);

  // The character's full visible height — head-top down to the feet — is scaled
  // to `characterHeight`, the same world height the composer's camera assumes.
  // Keeping the two in step is what makes the camera crop at the right places.
  const spriteHeight = body.bounds.height + overhang;
  const scale = characterHeight / spriteHeight;

  // Position so the feet land on the ground and the face centre lands on the
  // composer's `x`.
  const faceSpriteX = headDx + head.tailAnchor.x;
  const tx = c.x - scale * faceSpriteX;
  const ty = groundY - scale * body.bounds.height;

  // Facing is a horizontal mirror about the character's own x.
  const flip = c.facing === 'left' ? `translate(${2 * c.x},0) scale(-1,1) ` : '';

  const bodyMarkup = options.sprite(body.src, c.characterId);
  const headMarkup = options.sprite(head.src, c.characterId);
  const headGroup = (m: string): string => `<g transform="translate(${headDx},${headDy})">${m}</g>`;

  // The halo filter runs over the whole head+body group, so the white aura
  // follows the assembled silhouette as one shape — no seam where the head
  // meets the body.
  return `<g transform="${flip}translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(4)})">
  <g filter="url(#${haloId})">
    <g>${bodyMarkup}</g>
    ${headGroup(headMarkup)}
  </g>
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
  // Matches the composer's default metrics, so the outline agrees with the
  // text the composer wrapped.
  const metrics = options.metrics ?? createApproximateMetrics();
  const lineHeight = metrics.lineHeight;

  // The character world the composer's camera assumes: feet at the panel
  // bottom, full standing height a fixed fraction of the panel.
  const groundY = h;
  const characterHeight = h * (options.characterHeightFraction ?? 0.82);

  // Map the camera's world window onto the panel viewport.
  const cam = panel.camera;
  const camScale = w / cam.width;
  const clipId = `clip-${panel.panelIndex}`;
  const haloId = `halo-${panel.panelIndex}`;

  const backdropArt = options.backdrops?.[panel.backdrop];
  const characterLayer = panel.characters
    .map((c) => renderCharacter(c, options, groundY, characterHeight, haloId))
    .join('\n');

  const parts: string[] = [];

  // The §6.1 halo: dilate a character's assembled silhouette and flood it white
  // behind the art, so the figure keeps a clean white aura against a busy
  // backdrop. Applied to the whole head+body group, so the aura is uniform and
  // seamless (baking it per-part leaves a ring at the neck). The radius is in
  // sprite pixels — matching the ~4px dilation of the original Comic Chat aura —
  // and rides the character's scale, so the halo thickens on close-ups just as
  // the original bitmap aura did.
  parts.push(
    `<defs>` +
      `<clipPath id="${clipId}"><rect x="3" y="3" width="${w - 6}" height="${h - 6}"/></clipPath>` +
      `<filter id="${haloId}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">` +
      `<feMorphology in="SourceAlpha" operator="dilate" radius="${HALO_RADIUS}" result="d"/>` +
      `<feFlood flood-color="#ffffff" result="w"/>` +
      `<feComposite in="w" in2="d" operator="in" result="halo"/>` +
      `<feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge>` +
      `</filter>` +
      `</defs>`,
  );
  parts.push(
    `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="${options.background ?? '#fdfdf8'}" stroke="#111" stroke-width="3"/>`,
  );

  // The backdrop fills the panel behind the characters, bottom-aligned so its
  // ground sits where the characters stand. It is *not* put through the camera
  // transform: tying a flat scene image to the character zoom drifts the
  // horizon and, on close-ups, frames a meaningless slice of it. Characters are
  // drawn through the camera; balloons come last in unscaled panel space —
  // "word balloons are unaffected by the virtual zoom factor" (§6.2).
  parts.push(
    `<g clip-path="url(#${clipId})">` +
      (backdropArt ?? '') +
      `<g transform="scale(${camScale.toFixed(4)}) translate(${(-cam.x).toFixed(2)},${(-cam.y).toFixed(2)})">` +
      characterLayer +
      `</g></g>`,
  );

  if (options.debug) {
    parts.push(
      `<line x1="0" y1="${h * 0.55}" x2="${w}" y2="${h * 0.55}" stroke="#ccc" stroke-dasharray="4 4"/>`,
    );
  }

  // Reading order determines paint order, so later balloons overlap earlier
  // ones rather than the other way round.
  const ordered = [...panel.balloons].sort((a, b) => a.readingOrder - b.readingOrder);
  for (const b of ordered) parts.push(renderBalloon(b, lineHeight, metrics));

  if (options.debug) {
    parts.push(
      `<text x="6" y="${h - 6}" font-size="9" fill="#999">scale ${cam.scale.toFixed(2)} · ${panel.zoom}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${parts.join('\n')}
</svg>`;
}

/** Render every panel to a single SVG string per panel. */
export function renderPanelsToSvg(panels: readonly Panel[], options: RenderOptions): string[] {
  return panels.map((p) => renderPanelToSvg(p, options));
}
