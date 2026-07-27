/**
 * Copy the freshly built demo into one or more local staging directories — the
 * onionmadder.com webroot's `/comic-chat-composer/` and the onionmadder.xyz
 * (Neocities mirror) copy — so the hosted copies stay current after a rebuild.
 * Run via `npm run deploy:stage`, which builds first (`npm run demo`).
 *
 * The destinations are deliberately NOT committed — machine-specific paths, and
 * this repo is public. Provide them either way (multiple targets are allowed):
 *   • set `COMIC_STAGE_DIR` to one or more folders (separated by `;` or newlines), or
 *   • put one folder path per line in `examples/demo/.stage-dir` (gitignored).
 *
 * This only stages local copies; publishing to each live host is still a separate
 * manual step (WinSCP for .com, the Neocities uploader/CLI for .xyz — see CLAUDE.md).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The deployable set: the generated page + app bundle, the stylesheet, and the
// brand font it references. Relative paths are preserved under each target. The
// same set serves both mirrors — canonical/OG point at the primary (.com), which
// is what a mirror should do.
const FILES = ['index.html', 'app.js', 'style.css', 'assets/ChakraPetch-Regular.ttf'];

/** Resolve every staging directory from the env var, else the gitignored `.stage-dir`. */
function resolveTargets(): string[] {
  const env = process.env.COMIC_STAGE_DIR?.trim();
  if (env) return env.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);

  const cfg = join(here, '.stage-dir');
  if (existsSync(cfg)) {
    return readFileSync(cfg, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  return [];
}

const targets = resolveTargets();
if (targets.length === 0) {
  console.error(
    'No staging directory set. Either:\n' +
      '  • set COMIC_STAGE_DIR to one or more folders (separated by ; or newlines), or\n' +
      '  • put one folder path per line in examples/demo/.stage-dir (gitignored),\n' +
      'then re-run `npm run deploy:stage`.',
  );
  process.exit(1);
}

// Verify the build outputs exist once, up front.
for (const rel of FILES) {
  if (!existsSync(join(here, rel))) {
    console.error(`Build output missing at ${join(here, rel)}. Run \`npm run demo\` first.`);
    process.exit(1);
  }
}

for (const target of targets) {
  for (const rel of FILES) {
    const dest = join(target, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(here, rel), dest);
  }
  console.log(`staged ${FILES.length} files → ${target}`);
}
console.log('Local staging only — upload to each live host separately (WinSCP / Neocities).');
