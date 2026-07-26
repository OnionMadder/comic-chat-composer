/**
 * The golden-master scenario: one chat log exercised end-to-end through the
 * composer, whose output is snapshotted to `panels.json`.
 *
 * The scenario deliberately touches every moving part of composition so the
 * snapshot fails loudly if any of them drifts:
 *
 *  - joins → establishing shots, and a periodic establishing shot;
 *  - gesture/expression inference: emoticons, `LOL`/`IMHO`/`BRB`, ALL-CAPS and
 *    `!!!` shouting, greetings, self/other references;
 *  - explicit and inferred addressees, and the facing solver they drive;
 *  - balloon kinds: speech, whisper, thought, and an action narration box;
 *  - a panel break from an expression conflict, and one from the cast cap;
 *  - a long utterance that splits across continued balloons;
 *  - camera framing variety across solo, pair and crowd panels.
 *
 * The cast is the committed `nib` character, so the snapshot depends only on
 * checked-in assets and the seeded RNG — deterministic across machines.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compose, type ComposeInput } from '../../src/compose.ts';
import { parseCharacterManifest } from '../../src/manifest.ts';
import type { ChatEvent, Panel } from '../../src/types.ts';

const nib = parseCharacterManifest(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../assets/characters/nib/character.json', import.meta.url)), 'utf8'),
  ),
);

const AUTHORS = ['alice', 'bob', 'cara', 'dan', 'evan', 'fran'] as const;

let clock = 0;
const at = () => clock++;
const join = (author: string): ChatEvent => ({ type: 'join', author, at: at() });
const msg = (author: string, text: string, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  type: 'message',
  author,
  text,
  at: at(),
  ...extra,
} as ChatEvent);

export const GOLDEN_EVENTS: ChatEvent[] = [
  join('alice'),
  join('bob'),
  msg('alice', 'Hi Bob! :-)'),
  msg('bob', 'Hey Alice, LOL you are back', { addressees: ['alice'] }),
  { type: 'action', author: 'alice', text: 'waves cheerfully', at: at() },
  msg('alice', 'I MISSED YOU!!!', { addressees: ['bob'] }),
  msg('bob', 'IMHO you should visit more often', { addressees: ['alice'] }),
  msg('alice', 'BRB making tea'),
  join('cara'),
  msg('cara', 'Did you two start without me? :-(', { addressees: ['alice', 'bob'] }),
  msg('alice', 'never :-)', { addressees: ['cara'] }),
  msg('bob', 'we were only warming up', { kind: 'whisper', addressees: ['cara'] }),
  msg('cara', 'I wonder if they mean it', { kind: 'thought' }),
  msg('dan', 'YOU ARE ALL TERRIBLE', { addressees: ['alice', 'bob', 'cara'] }),
  msg(
    'evan',
    'Let me tell you a very long story about the time we all went to the lake and ' +
      'the boat sank and we had to swim back while the ducks watched us with great ' +
      'judgement and not a little contempt in their small round eyes, and then it ' +
      'started to rain, and the one umbrella we had brought turned inside out in the ' +
      'wind, and somehow this was still a better afternoon than the meeting we had ' +
      'skipped to be there, which really tells you everything you need to know about ' +
      'that particular quarter and the people running it',
  ),
  msg('fran', 'hello everyone, are you ready to go?', { addressees: ['evan'] }),
  msg('alice', 'yes!', { addressees: ['fran'] }),
];

/** The composer input the golden master is built from. */
export function goldenInput(): ComposeInput {
  return {
    events: GOLDEN_EVENTS,
    cast: Object.fromEntries(AUTHORS.map((a) => [a, { characterId: 'nib' }])),
    characterAssets: { nib },
    backdrops: ['room', 'field', 'pastoral'],
    seed: 20260725,
  };
}

/** Compose the golden scenario. */
export function composeGolden(): Panel[] {
  return compose(goldenInput());
}

export const GOLDEN_PATH = fileURLToPath(new URL('./panels.json', import.meta.url));
