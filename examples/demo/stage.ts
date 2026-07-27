/**
 * Copy the freshly built demo (`examples/demo/index.html`) into a local staging
 * directory — e.g. the onionmadder.com webroot's `/comic-chat-composer/` — so the
 * hosted copy stays current after a rebuild. Run via `npm run deploy:stage`,
 * which builds first (`npm run demo`) and then invokes this.
 *
 * The destination is deliberately NOT committed — it's a machine-specific path,
 * and this repo is public. Provide it either way:
 *   • set the `COMIC_STAGE_DIR` env var to the target folder, or
 *   • put the folder path on one line in `examples/demo/.stage-dir` (gitignored).
 *
 * This only stages a local copy; publishing to the live host is still a separate
 * manual step (WinSCP upload — see CLAUDE.md).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The deployable set: the generated page + app bundle, the stylesheet, and the
// brand font it references. Relative paths are preserved under the target.
const FILES = ['index.html', 'app.js', 'style.css', 'assets/ChakraPetch-Regular.ttf'];

/** Resolve the staging directory from the env var, else the gitignored `.stage-dir`. */
function resolveTarget(): string | null {
  const env = process.env.COMIC_STAGE_DIR?.trim();
  if (env) return env;

  const cfg = join(here, '.stage-dir');
  if (existsSync(cfg)) {
    const line = readFileSync(cfg, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (line) return line;
  }
  return null;
}

const target = resolveTarget();
if (!target) {
  console.error(
    'No staging directory set. Either:\n' +
      '  • set COMIC_STAGE_DIR to the target folder, or\n' +
      '  • put the folder path on one line in examples/demo/.stage-dir (gitignored),\n' +
      'then re-run `npm run deploy:stage`.',
  );
  process.exit(1);
}

for (const rel of FILES) {
  const src = join(here, rel);
  if (!existsSync(src)) {
    console.error(`Build output missing at ${src}. Run \`npm run demo\` first.`);
    process.exit(1);
  }
  const dest = join(target, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
console.log(`staged ${FILES.length} files → ${target}`);
console.log('Local staging only — upload to the live host separately (WinSCP).');
