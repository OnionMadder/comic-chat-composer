/**
 * Tile composed panels into a single comic-strip SVG.
 *
 * Each panel is rendered by {@link renderPanelToSvg} and nested at a translated
 * position inside one outer `<svg>`. Nested SVGs keep their own coordinate
 * system and clip ids, so panels compose without collision. The result is one
 * self-contained document — every sprite is an inline data URI — suitable for
 * saving straight to a file or rasterising to PNG.
 */

import type { Panel } from '../src/types.ts';
import { renderPanelToSvg, type RenderOptions } from './render-svg.ts';

export interface StripLayout {
  /** Panels per row. Default 3. */
  columns?: number;
  /** Gutter between panels, px. Default 14. */
  gap?: number;
  /** Margin around the whole page, px. Default 18. */
  padding?: number;
  /** Page background behind the panels. Default a light paper tone. */
  background?: string;
  /** Optional title, drawn as a header band above the panels (comic lettering). */
  title?: string;
  /** Optional subtitle / byline, under the title. */
  subtitle?: string;
  /** Optional small credit line, drawn below the panels. */
  credit?: string;
  /**
   * Append a "starring" curtain-call panel listing the cast.
   *
   * The original client built one of these (`AddStars`): a panel of avatar
   * icons captioned "nickname as character-name", with the cast ordered by how
   * much each of them had actually said. This reproduces it as a final tile.
   */
  credits?: boolean;
}

const COMIC_FONT = "'Comic Sans MS','Comic Neue',cursive";

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build the "starring" curtain-call tile: the cast lined up and waving, each
 * captioned with the speaker who played them.
 *
 * The cast is ordered by how much each character spoke, which is how the
 * original ranked its credits — the loudest participant leads.
 *
 * Reuses the real renderer via a synthetic panel (as the demo's character
 * preview does), so figures resolve exactly as they do in the comic: layered or
 * whole-figure art, halos, the works. The camera is pulled back far enough to
 * fit the whole line-up and to leave a band at the bottom for the captions.
 */
function renderCreditsTile(
  panels: readonly Panel[],
  options: RenderOptions,
  x: number,
  y: number,
): string {
  const pw = options.panelWidth;
  const ph = options.panelHeight;

  // Who played whom, ordered by line count (ties keep first appearance).
  const lines = new Map<string, number>();
  const characterOf = new Map<string, string>();
  for (const panel of panels) {
    for (const c of panel.characters) {
      if (!characterOf.has(c.author)) characterOf.set(c.author, c.characterId);
      if (!lines.has(c.author)) lines.set(c.author, 0);
    }
    for (const b of panel.balloons) {
      lines.set(b.speaker, (lines.get(b.speaker) ?? 0) + 1);
    }
  }
  const cast = [...characterOf.keys()]
    .sort((a, b) => (lines.get(b) ?? 0) - (lines.get(a) ?? 0))
    .slice(0, 6);

  const captionFraction = 0.24;
  const headerFraction = 0.16;
  const captionBand = Math.round(ph * captionFraction);
  // Pull back far enough that the line-up fits across the panel *and* clears
  // both the caption band and the "STARRING" header — a waving arm reaches the
  // full character height, so the vertical fit is the binding constraint for
  // small casts.
  const figureFraction = options.characterHeightFraction ?? 0.82;
  const verticalFit = (1 - headerFraction - captionFraction) / figureFraction;
  const scale = Math.min(verticalFit, 2.6 / Math.max(1, cast.length));
  const worldWidth = pw / scale;
  // Put the characters' feet just above the caption band.
  const groundScreenY = ph - captionBand;
  const cameraY = ph - groundScreenY / scale;

  const slots = cast.map((_, i) => ((i + 1) * worldWidth) / (cast.length + 1));
  const mid = (cast.length - 1) / 2;

  const panel: Panel = {
    panelIndex: -1,
    zoom: 'wide',
    camera: { x: 0, y: cameraY, width: worldWidth, height: ph / scale, scale },
    characters: cast.map((author, i) => ({
      author,
      characterId: characterOf.get(author)!,
      x: slots[i]!,
      // Turn the ends of the line inward, so the cast frames the panel.
      facing: i < mid ? 'right' : i > mid ? 'left' : 'right',
      gesture: 'wave',
      expression: 'happy',
      poseVariant: i,
    })),
    balloons: [],
    backdrop: '',
  };

  const figures = renderPanelToSvg(panel, options).replace('<svg ', `<svg x="${x}" y="${y}" `);

  const captions = cast.flatMap((author, i) => {
    const cx = x + (slots[i]! * scale);
    const name = options.characters[characterOf.get(author)!]?.name ?? characterOf.get(author)!;
    const baseline = y + ph - captionBand + 22;
    return [
      `<text x="${cx.toFixed(1)}" y="${baseline}" text-anchor="middle" font-family="${COMIC_FONT}"` +
        ` font-size="15" font-weight="bold" fill="#111">${escapeXml(author)}</text>`,
      `<text x="${cx.toFixed(1)}" y="${baseline + 17}" text-anchor="middle" font-family="${COMIC_FONT}"` +
        ` font-size="12" fill="#444">as ${escapeXml(name)}</text>`,
    ];
  });

  return [
    figures,
    `<text x="${x + pw / 2}" y="${y + Math.round(ph * 0.115)}" text-anchor="middle"` +
      ` font-family="${COMIC_FONT}" font-size="23" font-weight="bold" fill="#111">STARRING</text>`,
    ...captions,
  ].join('\n');
}

/**
 * Render every panel into one strip SVG.
 *
 * @example
 * ```ts
 * const svg = renderStripSvg(panels, renderOptions, { columns: 2 });
 * ```
 */
export function renderStripSvg(
  panels: readonly Panel[],
  options: RenderOptions,
  layout: StripLayout = {},
): string {
  const columns = Math.max(1, layout.columns ?? 3);
  const gap = layout.gap ?? 14;
  const padding = layout.padding ?? 18;
  const background = layout.background ?? '#f4f4f0';

  const pw = options.panelWidth;
  const ph = options.panelHeight;
  // The credits tile occupies one more cell in the same grid.
  const wantCredits = layout.credits === true && panels.length > 0;
  const tileCount = panels.length + (wantCredits ? 1 : 0);
  const cols = Math.min(columns, tileCount || 1);
  const rows = Math.ceil(tileCount / cols);

  const title = layout.title?.trim();
  const subtitle = layout.subtitle?.trim();
  const credit = layout.credit?.trim();

  // Header band (title + subtitle) above the grid; credit line below it.
  const titleSize = 34;
  const subtitleSize = 17;
  const headerH = (title ? titleSize + 12 : 0) + (subtitle ? subtitleSize + 8 : 0) + (title || subtitle ? 10 : 0);
  const footerH = credit ? 24 : 0;

  const gridTop = padding + headerH;
  const width = padding * 2 + cols * pw + (cols - 1) * gap;
  const height = gridTop + rows * ph + (rows - 1) * gap + footerH + padding;
  const cx = width / 2;

  const cellX = (i: number): number => padding + (i % cols) * (pw + gap);
  const cellY = (i: number): number => gridTop + Math.floor(i / cols) * (ph + gap);

  const tiles = panels.map((panel, i) => {
    // Nest the panel's own <svg>, positioned with x/y.
    return renderPanelToSvg(panel, options).replace(
      '<svg ',
      `<svg x="${cellX(i)}" y="${cellY(i)}" `,
    );
  });

  if (wantCredits) {
    const i = panels.length;
    tiles.push(renderCreditsTile(panels, options, cellX(i), cellY(i)));
  }

  const header: string[] = [];
  if (title) {
    header.push(
      `<text x="${cx}" y="${padding + titleSize}" text-anchor="middle" font-family="${COMIC_FONT}"` +
        ` font-size="${titleSize}" font-weight="bold" fill="#111">${escapeXml(title)}</text>`,
    );
  }
  if (subtitle) {
    const y = padding + (title ? titleSize + 12 : 0) + subtitleSize;
    header.push(
      `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${COMIC_FONT}"` +
        ` font-size="${subtitleSize}" font-style="italic" fill="#555">${escapeXml(subtitle)}</text>`,
    );
  }
  if (credit) {
    header.push(
      `<text x="${cx}" y="${height - padding + 4}" text-anchor="middle" font-family="${COMIC_FONT}"` +
        ` font-size="13" fill="#9a9a9a">${escapeXml(credit)}</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>` +
    tiles.join('') +
    header.join('') +
    `</svg>`
  );
}
