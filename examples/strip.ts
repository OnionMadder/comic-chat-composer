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
  const cols = Math.min(columns, panels.length || 1);
  const rows = Math.ceil(panels.length / cols);

  const width = padding * 2 + cols * pw + (cols - 1) * gap;
  const height = padding * 2 + rows * ph + (rows - 1) * gap;

  const tiles = panels.map((panel, i) => {
    const x = padding + (i % cols) * (pw + gap);
    const y = padding + Math.floor(i / cols) * (ph + gap);
    // Nest the panel's own <svg>, positioned with x/y.
    const inner = renderPanelToSvg(panel, options).replace('<svg ', `<svg x="${x}" y="${y}" `);
    return inner;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>` +
    tiles.join('') +
    `</svg>`
  );
}
