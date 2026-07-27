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
}

const COMIC_FONT = "'Comic Sans MS','Comic Neue',cursive";

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  const cols = Math.min(columns, panels.length || 1);
  const rows = Math.ceil(panels.length / cols);

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

  const tiles = panels.map((panel, i) => {
    const x = padding + (i % cols) * (pw + gap);
    const y = gridTop + Math.floor(i / cols) * (ph + gap);
    // Nest the panel's own <svg>, positioned with x/y.
    const inner = renderPanelToSvg(panel, options).replace('<svg ', `<svg x="${x}" y="${y}" `);
    return inner;
  });

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
