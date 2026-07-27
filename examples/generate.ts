/**
 * A procedural conversation generator for the demo's seed roll.
 *
 * The hand-written {@link CONVERSATIONS} corpus is finite, so seeds repeat. This
 * fills the gap: mad-libs-style templates whose participant names and filler
 * words are drawn from pools by the seeded PRNG. A dozen templates × ~48 names ×
 * themed word pools makes the odds of two seeds colliding vanishingly small,
 * while `generateConversation` stays a pure function of the seed (same seed →
 * same comic), the same determinism the whole pipeline relies on.
 *
 * Every so often it returns a curated corpus conversation instead, so the
 * best-written ones still surface. Output is the same `name (hint): text` script
 * the demo already understands.
 */

import { createRandom, type Random } from '../src/rng.ts';
import { CONVERSATIONS } from './corpus.ts';

// Short chat-handle names. Deliberately none of the bundled character ids, so
// casting stays seed-driven (see `resolveCast` in the demo).
const NAMES = [
  'kip', 'dara', 'ovi', 'pip', 'sana', 'reef', 'nyx', 'obi', 'vale', 'pia',
  'wynn', 'lex', 'rho', 'sib', 'taj', 'uma', 'quill', 'fenn', 'gale', 'ziggy',
  'cass', 'dex', 'orla', 'teo', 'hugo', 'dot', 'sy', 'ines', 'rook', 'jinx',
  'vee', 'gil', 'bev', 'hank', 'edd', 'nol', 'suri', 'bree', 'cort', 'del',
  'nan', 'ozzy', 'pru', 'zia', 'mox', 'wren', 'cleo', 'bax',
] as const;

// Filler pools. Keyed by slot name; a trailing digit picks a *separate* draw
// from the same pool (`{ingredient}` and `{ingredient2}` are both foods, but
// resolve independently). Every value has to read fine in every slot it fills.
const POOLS: Record<string, readonly string[]> = {
  chore: ['did the slides', 'booked the venue', 'emailed the client', 'fed the server', 'made the flyer', 'called the caterer'],
  vibe: ['the vision', 'vibes', 'raw confidence', 'a rough plan', 'pure energy', 'a feeling'],
  deadline: ['IT SHIPS AT NOON', 'THE CLIENT IS HERE', "IT'S DUE IN AN HOUR", 'DOORS OPEN AT SEVEN', 'WE GO LIVE AT FIVE'],
  group: ['family', 'team', 'guild', 'group chat', 'band', 'book club'],
  system: ['prod', 'the wifi', 'the printer', 'the whole cluster', 'payroll', 'the database'],
  place: ['the tavern', 'the crypt', 'the market', 'the throne room', 'the dungeon'],
  npc: ['the barkeep', 'the guard', 'the wizard', 'the merchant', 'the innkeeper'],
  rashAction: ['seduce', 'challenge', 'befriend', 'rob', 'high-five'],
  stat: ['charisma', 'strength', 'luck', 'stealth'],
  mundaneThing: ['a coat rack', 'a lamp', 'a very still statue', 'a broom', 'a mannequin'],
  food: ['my labeled leftovers', 'the last slice', 'my birthday cake', 'the good cheese', 'the office donuts'],
  evidence: ['fork', 'spoon', 'crumbs', 'wrapper', 'napkin'],
  creature: ['leftovers ghost', 'office raccoon', 'fridge gremlin', 'building cat', 'snack goblin'],
  greeting: ['HAPPY BIRTHDAY!!!', 'CONGRATS!!!', 'WELCOME HOME!!!', 'SURPRISE!!!', 'BON VOYAGE!!!'],
  time: ['seven', 'noon', 'eight sharp', 'after work', 'half past six'],
  hazard: ['the fire', 'the poison', 'the lava', 'the bad circle', 'the spikes'],
  role: ['tank', 'healer', 'carry', 'support', 'lookout'],
  resource: ['healing', 'mana', 'the cooldown', 'the ult', 'my patience'],
  item: ['trash cans', 'recycling', 'garden gnome', 'lawn flamingo', 'wind chimes'],
  bignum: ['twelve', 'forty', 'nine hundred', 'too many', 'a concerning number of'],
  lateTime: ['midnight', '3am', 'past our bedtime', 'the witching hour'],
  event: ['exam', 'deadline', 'recital', 'launch', 'wedding'],
  verb: ['blinking', 'screaming', 'smoking', 'beeping', 'glowing'],
  harmless: ['the snack machine', 'the coffee maker', 'a fan', 'Greg', 'the microwave'],
  clue: ['look up', 'turn left', 'count the stars', 'follow the red', 'mind the gap'],
  clueAction: ['looking up', 'turning left', 'counting', 'following it', 'minding it'],
  ceiling: ['a ceiling', 'a wall', 'a door', 'a rug', 'a very normal floor'],
  spot: ['rug', 'fan', 'cushion', 'plant', 'lampshade'],
  dish: ['main dish', 'salad', 'dessert', 'casserole', 'dip'],
  ingredient: ['raisins', 'mystery meat', 'too much cilantro', 'glitter', 'a whole bay leaf'],
  venue: ['garage', 'basement', 'dorm', 'shed', 'attic'],
  smell: ['old decisions', 'damp regret', 'expired hope', 'gym socks', 'burnt toast'],
};

interface Template {
  cast: number;
  lines: readonly string[];
}

// Each template is a funny *structure*; the slots vary the specifics. `{A}`–`{D}`
// are participants; `{word}` pulls from POOLS. A repeated slot resolves once and
// stays consistent within the conversation.
const TEMPLATES: readonly Template[] = [
  {
    cast: 4,
    lines: [
      '{A}: so who actually {chore}',
      '{B}: I thought {C} {chore}',
      '{C} -> {A}: you literally said you had it',
      '{D}: I un-muted this chat for exactly this',
      '{A} (coy): I have {vibe} handled',
      '{B} (shout): {deadline}',
      '{D} (think): can you un-join a {group}',
      '{A} (happy): we are presenting {vibe}',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: {system} is down',
      '{B} (bored): did you try turning it off and on',
      "{A} -> {B}: {B}, it's {system}",
      '{C}: who touched it last',
      '{B} (coy): define "touched"',
      '{A} (shout): {B}',
      "{C} (shrug): I'm updating my resume",
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: you enter {place}, {npc} eyes you',
      '{B} (happy): I {rashAction} {npc}',
      '{C}: we JUST got here',
      '{A} -> {B}: roll for {stat}',
      '{B}: natural one',
      '{C} (laugh): {npc} is deeply unimpressed',
      '{A} (bored): also, {npc} was {mundaneThing}',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: okay, who ate {food}',
      '{B} (whisper): not it',
      '{C} (whisper): not it',
      '* {B} slowly hides a {evidence}',
      '{A} -> {B}: your {evidence} is right there',
      '{C} (laugh): planted, {B}? really?',
      '{B} (shrug): the {creature} did it',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: {greeting} see everyone at {time}',
      '{B}: ...who is this',
      '{A} (scared): wait, is this not the surprise chat',
      "{C} -> {A}: I'm the surprise. hi.",
      '{B} (laugh): incredible work, {A}',
      '{A}: everyone act natural',
      '{C} (coy): a bit late for that',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: everyone stack on me',
      "{B}: you're standing in {hazard}",
      '{A} (bored): it is a cozy {hazard}',
      '{C} -> {A}: you are the {role}, {A}',
      '{A}: I am a vibes {role}',
      '{B} (shout): SOMEONE HEAL THE VIBES',
      '{C} (laugh): {resource} is on cooldown, godspeed',
    ],
  },
  {
    cast: 3,
    lines: [
      "{A}: someone's {item} were out a day early",
      '{B} (bored): call the president, {A}',
      '{A} (angry): I AM the president',
      '{C} -> {A}: then police your own {item}',
      '{A} (coy): my {item} are merely aspirational',
      '{B} (laugh): motion to impeach the {item}',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: okay, let us review chapter one',
      '{B}: {A}, there are {bignum} chapters',
      '{A} (scared): there are {bignum} chapters',
      '{C} -> {A}: it is currently {lateTime}',
      "{A} (think): if we never sleep, the {event} can't arrive",
      '{B} (laugh): that is not how time works',
      "{C}: it's a little how the {event} works",
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: telemetry is nominal',
      '{B}: define nominal',
      "{A} -> {B}: everything's fine, {B}",
      '{C} (scared): then why is the fine light {verb}',
      "{A}: that's {harmless}",
      '{B} (laugh): copy, {harmless} anomaly',
      '{C} (happy): I will investigate personally',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: the clue just says "{clue}"',
      '{B}: I am {clueAction}, it is just {ceiling}',
      '{C} -> {A}: read it again, slowly',
      '{A} (coy): "{clue}"... online, maybe?',
      '{B} (shout): it was under the {spot} the whole time',
      '{C} (laugh): who hides a key under a {spot}',
      '{A} (happy): a genius, a monster',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: I will bring the {dish}',
      '{B}: I have got the drinks',
      '{C} -> {A}: what IS the {dish}, though',
      '{A} (coy): a surprise',
      '{B} (scared): the last surprise had {ingredient}',
      '{C} (angry): {A}',
      '{A} (laugh): it was {ingredient2}, probably',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: practice moved to my {venue}',
      '{B}: your {venue} smells like {smell}',
      '{C} -> {A}: is the drummer actually coming',
      '{A} (bored): the drummer is always "coming"',
      '{B} (laugh): the drummer is folklore',
      '{C} (shout): I AM RIGHT HERE',
      '{A} (coy): prove it, count us in',
    ],
  },
];

/** How often the roll returns a hand-written corpus conversation instead of a generated one. */
const CURATED_ODDS = 4; // 1 in 4

function pick<T>(rng: Random, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** A seeded Fisher–Yates shuffle, returning a fresh array. */
function shuffle<T>(arr: readonly T[], rng: Random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function fill(template: Template, rng: Random): string {
  const names = shuffle(NAMES, rng).slice(0, template.cast);
  const cache = new Map<string, string>();

  const resolve = (slot: string): string => {
    // Participants: single letter A–D.
    if (slot.length === 1 && slot >= 'A' && slot <= 'Z') {
      const i = slot.charCodeAt(0) - 65;
      return names[i] ?? names[0] ?? 'someone';
    }
    // Filler: resolve once, keep consistent within the conversation.
    const existing = cache.get(slot);
    if (existing !== undefined) return existing;
    const pool = POOLS[slot.replace(/\d+$/, '')];
    const value = pool ? pick(rng, pool) : slot;
    cache.set(slot, value);
    return value;
  };

  return template.lines
    .map((line) => line.replace(/\{(\w+)\}/g, (_, slot: string) => resolve(slot)))
    .join('\n');
}

/**
 * Build a conversation script for a seed. Deterministic: the same seed always
 * yields the same comic.
 */
export function generateConversation(seed: number): string {
  const rng = createRandom(seed);
  if (Math.floor(rng() * CURATED_ODDS) === 0) return pick(rng, CONVERSATIONS);
  return fill(pick(rng, TEMPLATES), rng);
}

// Exposed for tests.
export const _internals = { NAMES, POOLS, TEMPLATES };
