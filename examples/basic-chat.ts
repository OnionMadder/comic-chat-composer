/**
 * End-to-end example: a short chat log composed into panels, using the Nib
 * reference character.
 *
 * Run with:
 *   npm run example
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compose } from '../src/compose.ts';
import { bodyForGesture, headForExpression, parseCharacterManifest } from '../src/manifest.ts';
import type { ChatEvent, Expression, Gesture } from '../src/types.ts';

const manifestPath = fileURLToPath(
  new URL('../assets/characters/nib/character.json', import.meta.url),
);
const nib = parseCharacterManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));

const events: ChatEvent[] = [
  { type: 'join', author: 'alice', at: 0 },
  { type: 'join', author: 'bob', at: 1 },
  { type: 'message', author: 'alice', text: 'Hi Bob!', at: 2 },
  { type: 'message', author: 'bob', text: "Hey Alice, LOL you're back", at: 3, addressees: ['alice'] },
  { type: 'action', author: 'alice', text: 'waves cheerfully', at: 4 },
  { type: 'message', author: 'alice', text: 'I MISSED YOU!!!', at: 5, addressees: ['bob'] },
  { type: 'message', author: 'bob', text: 'IMHO you should visit more often', at: 6, addressees: ['alice'] },
  { type: 'join', author: 'cara', at: 7 },
  { type: 'message', author: 'cara', text: 'Did you two start without me? :-(', at: 8 },
  { type: 'message', author: 'alice', text: 'never :-)', at: 9, addressees: ['cara'] },
];

const panels = compose({
  events,
  cast: {
    alice: { characterId: 'nib' },
    bob: { characterId: 'nib' },
    cara: { characterId: 'nib' },
  },
  backdrops: ['room', 'field', 'pastoral'],
  seed: 1234,
});

/**
 * The composer returns identity and geometry only. Resolving that to sprites
 * is the renderer's job — here, just to show which files a renderer would pull.
 */
const assetsFor = (expression: Expression, gesture: Gesture) => ({
  head: headForExpression(nib, expression).src,
  body: bodyForGesture(nib, gesture).src,
});

console.log(`${events.length} events → ${panels.length} panels\n`);

for (const panel of panels) {
  console.log(`── panel ${panel.panelIndex} · ${panel.zoom} · backdrop "${panel.backdrop}"`);

  for (const c of panel.characters) {
    const { head, body } = assetsFor(c.expression, c.gesture);
    console.log(
      `   ${c.author.padEnd(6)} x=${c.x.toFixed(0).padStart(3)} facing ${c.facing.padEnd(5)}` +
        ` ${c.expression}/${c.gesture}  [${head} + ${body}]`,
    );
  }

  for (const b of [...panel.balloons].sort((a, b) => a.readingOrder - b.readingOrder)) {
    const box = `x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} ${b.width.toFixed(0)}×${b.height.toFixed(0)}`;
    console.log(`   ${b.readingOrder}. [${b.kind}] ${JSON.stringify(b.text)} ${box}`);
    for (const line of b.lines) console.log(`        | ${line}`);
    if (b.tail) {
      console.log(
        `        tail ${b.tail.fromX.toFixed(0)},${b.tail.fromY.toFixed(0)}` +
          ` → ${b.tail.toX.toFixed(0)},${b.tail.toY.toFixed(0)} (${b.tail.curve})`,
      );
    }
  }
  console.log();
}
