/**
 * Text measurement and wrapping.
 *
 * The composer never rasterises anything, but the balloon layout in §5.2 is
 * driven by real typographic quantities: the area a line of text covers, the
 * width of the widest single word, and the number of lines the text breaks
 * into at a candidate width. Those all need font metrics.
 *
 * Rather than depend on a canvas or a font library, metrics are an injectable
 * interface. {@link createApproximateMetrics} provides a dependency-free
 * estimate good enough for layout; callers with access to a real text shaper
 * (browser canvas, node-canvas, satori) should pass their own.
 */

/** Everything the layout needs to know about the balloon font. */
export interface FontMetrics {
  /** Baseline-to-baseline distance for one line of balloon text. */
  lineHeight: number;
  /** Width of `text` typeset on a single unbroken line. */
  measure(text: string): number;
}

/** Characters markedly narrower than the average advance. */
const NARROW = new Set([...`ijltfIJ1.,;:'"\`!|()[]{}/\\ `]);
/** Characters markedly wider than the average advance. */
const WIDE = new Set([...'mwMW@%&']);

export interface ApproximateMetricsOptions {
  /** Nominal font size in layout units. Default 12. */
  fontSize?: number;
  /** Average advance as a fraction of font size. Default 0.62. */
  advanceRatio?: number;
  /** Line height as a multiple of font size. Default 1.25. */
  lineHeightRatio?: number;
}

/**
 * Build metrics from a simple per-character advance table.
 *
 * This is an approximation, not a shaper: no kerning, no ligatures, no
 * fallback. It is deliberately monotonic in string length so the layout
 * behaves sensibly, and it is stable across platforms so tests are portable.
 */
export function createApproximateMetrics(options: ApproximateMetricsOptions = {}): FontMetrics {
  const fontSize = options.fontSize ?? 12;
  const advance = fontSize * (options.advanceRatio ?? 0.62);
  const lineHeight = fontSize * (options.lineHeightRatio ?? 1.25);

  return {
    lineHeight,
    measure(text: string): number {
      let w = 0;
      for (const ch of text) {
        if (NARROW.has(ch)) w += advance * 0.5;
        else if (WIDE.has(ch)) w += advance * 1.45;
        else w += advance;
      }
      return w;
    },
  };
}

/** Width of the widest single word — a hard floor on balloon text width (§5.2). */
export function widestWordWidth(text: string, metrics: FontMetrics): number {
  let max = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    max = Math.max(max, metrics.measure(word));
  }
  return max;
}

/**
 * Greedy word wrap to `maxWidth`.
 *
 * A word wider than `maxWidth` is placed on a line of its own rather than
 * being broken mid-word — the layout's job is to avoid that situation by
 * respecting {@link widestWordWidth}, not to hyphenate.
 */
export function wrapText(text: string, maxWidth: number, metrics: FontMetrics): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && metrics.measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Width of the longest laid-out line — the true width of a wrapped block. */
export function measuredBlockWidth(lines: string[], metrics: FontMetrics): number {
  let max = 0;
  for (const line of lines) max = Math.max(max, metrics.measure(line));
  return max;
}

/**
 * Split text into the fewest chunks that each wrap into at most `maxLines`
 * lines at `maxWidth`, joining the seams with ellipses (§5.2: "we break up the
 * text of the balloon into smaller balloons that do fit ... and add ellipses to
 * each of the new balloons to indicate that a split occurred").
 */
export function splitIntoBalloonChunks(
  text: string,
  maxWidth: number,
  maxLines: number,
  metrics: FontMetrics,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];

  const fits = (candidate: string[]): boolean =>
    wrapText(candidate.join(' '), maxWidth, metrics).length <= maxLines;

  for (const word of words) {
    const candidate = [...current, word];
    if (current.length > 0 && !fits(candidate)) {
      chunks.push(current.join(' '));
      current = [word];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current.join(' '));

  if (chunks.length <= 1) return chunks;

  // Trailing ellipsis on every chunk but the last, leading on every chunk but
  // the first — the comic convention for a continued balloon.
  return chunks.map((chunk, i) => {
    const lead = i > 0 ? '...' : '';
    const trail = i < chunks.length - 1 ? '...' : '';
    return `${lead}${chunk}${trail}`;
  });
}
