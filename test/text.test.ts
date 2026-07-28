import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createApproximateMetrics,
  measuredBlockWidth,
  splitIntoBalloonChunks,
  widestWordWidth,
  wrapText,
} from '../src/text.ts';

const metrics = createApproximateMetrics();

describe('createApproximateMetrics', () => {
  it('measures deterministically', () => {
    // The whole pipeline is seeded-deterministic; a wobbling measure would
    // break the golden master.
    assert.equal(metrics.measure('hello world'), metrics.measure('hello world'));
  });

  it('is monotonic in string length', () => {
    assert.ok(metrics.measure('aaaa') > metrics.measure('aaa'));
    assert.ok(metrics.measure('aaa') > metrics.measure(''));
    assert.equal(metrics.measure(''), 0);
  });

  it('gives narrow characters less advance than wide ones', () => {
    assert.ok(metrics.measure('iiii') < metrics.measure('aaaa'));
    assert.ok(metrics.measure('llll') < metrics.measure('WWWW'));
    assert.ok(metrics.measure('MMMM') > metrics.measure('aaaa'));
  });

  it('exposes a positive line height', () => {
    assert.ok(metrics.lineHeight > 0);
  });
});

describe('wrapText', () => {
  it('honours maxWidth for normal text', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const maxWidth = metrics.measure('the quick brown');
    const lines = wrapText(text, maxWidth, metrics);
    assert.ok(lines.length > 1, 'text wider than maxWidth must wrap');
    for (const line of lines) {
      assert.ok(metrics.measure(line) <= maxWidth, `"${line}" exceeds maxWidth`);
    }
    // No word may be dropped or reordered by wrapping.
    assert.equal(lines.join(' '), text);
  });

  it('puts a word wider than maxWidth on its own line rather than dropping it', () => {
    // The layout is supposed to avoid this via widestWordWidth; when it happens
    // anyway, the word must survive un-hyphenated.
    const lines = wrapText('a supercalifragilistic b', metrics.measure('supe'), metrics);
    assert.deepEqual(lines, ['a', 'supercalifragilistic', 'b']);
  });

  it('returns [] for empty and whitespace-only input', () => {
    assert.deepEqual(wrapText('', 100, metrics), []);
    assert.deepEqual(wrapText('   \t  ', 100, metrics), []);
  });
});

describe('splitIntoBalloonChunks', () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
  const text = words.join(' ');
  const maxWidth = metrics.measure('word0 word1 word2');

  it('joins the seams of a multi-chunk split with ellipses', () => {
    const chunks = splitIntoBalloonChunks(text, maxWidth, 2, metrics);
    assert.ok(chunks.length > 1, 'this text cannot fit one chunk');
    chunks.forEach((chunk, i) => {
      if (i > 0) assert.ok(chunk.startsWith('...'), `chunk ${i} lacks a leading ellipsis`);
      if (i < chunks.length - 1) assert.ok(chunk.endsWith('...'), `chunk ${i} lacks a trailing ellipsis`);
    });
    // The comic convention: the first chunk opens clean, the last closes clean.
    assert.ok(!chunks[0]!.startsWith('...'));
    assert.ok(!chunks[chunks.length - 1]!.endsWith('...'));
  });

  it('preserves every input word across the chunks', () => {
    const chunks = splitIntoBalloonChunks(text, maxWidth, 2, metrics);
    const recovered = chunks
      .map((c) => c.replace(/^\.\.\./, '').replace(/\.\.\.$/, ''))
      .join(' ')
      .split(/\s+/);
    assert.deepEqual(recovered, words);
  });

  it('adds no ellipses when the text fits one chunk', () => {
    const chunks = splitIntoBalloonChunks('short line', 10_000, 10, metrics);
    assert.deepEqual(chunks, ['short line']);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(splitIntoBalloonChunks('   ', 100, 3, metrics), []);
  });
});

describe('widestWordWidth', () => {
  it('finds the widest single word', () => {
    const width = widestWordWidth('a bb ccc', metrics);
    assert.equal(width, metrics.measure('ccc'));
  });

  it('ignores whitespace runs', () => {
    assert.equal(widestWordWidth('  a   bb  ', metrics), metrics.measure('bb'));
    assert.equal(widestWordWidth('   ', metrics), 0);
  });
});

describe('measuredBlockWidth', () => {
  it('is the width of the longest laid-out line', () => {
    const lines = ['short', 'a much longer line', 'mid line'];
    assert.equal(measuredBlockWidth(lines, metrics), metrics.measure('a much longer line'));
  });

  it('is zero for an empty block', () => {
    assert.equal(measuredBlockWidth([], metrics), 0);
  });
});
