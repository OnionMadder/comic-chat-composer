/**
 * A procedural conversation generator for the demo's seed roll.
 *
 * The hand-written {@link CONVERSATIONS} corpus is finite, so seeds repeat. This
 * fills the gap: mad-libs-style templates whose participant names and filler
 * words are drawn from pools by the seeded PRNG. A few dozen templates (2–4
 * participants) × ~48 names × themed word pools makes seed collisions rare,
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
  stat: ['charisma', 'strength', 'luck', 'stealth', 'perception', 'sleight of hand'],
  mundaneThing: ['a coat rack', 'a lamp', 'a very still statue', 'a broom', 'a mannequin'],
  food: ['my labeled leftovers', 'the last slice', 'my birthday cake', 'the good cheese', 'the office donuts'],
  evidence: ['fork', 'spoon', 'crumb trail', 'wrapper', 'napkin'],
  creature: ['leftovers ghost', 'office raccoon', 'fridge gremlin', 'building cat', 'snack goblin'],
  greeting: ['HAPPY BIRTHDAY!!!', 'CONGRATS!!!', 'WELCOME HOME!!!', 'SURPRISE!!!', 'BON VOYAGE!!!'],
  time: ['seven', 'noon', 'eight sharp', 'after work', 'half past six'],
  // Bare nouns: the templates supply the article ("standing in the {hazard}",
  // "a cozy {hazard}"), so pool values must read in both slots.
  hazard: ['fire', 'poison cloud', 'lava pit', 'danger zone', 'spike trap'],
  role: ['tank', 'healer', 'carry', 'support', 'lookout'],
  resource: ['healing', 'mana', 'the healer', 'the ult', 'my patience'],
  // Consistently plural: the templates use plural agreement ("were out",
  // "are merely aspirational").
  item: ['trash cans', 'recycling bins', 'garden gnomes', 'lawn flamingos', 'wind chimes'],
  bignum: ['twelve', 'forty', 'nine hundred', 'too many', 'a concerning number of'],
  lateTime: ['midnight', '3am', 'past our bedtime', 'the witching hour'],
  event: ['exam', 'deadline', 'recital', 'launch', 'wedding'],
  verb: ['blinking', 'screaming', 'smoking', 'beeping', 'glowing'],
  harmless: ['the snack machine', 'the coffee maker', 'a fan', 'Greg', 'the microwave'],
  clue: ['look up', 'turn left', 'count the stars', 'follow the red', 'mind the gap'],
  ceiling: ['a ceiling', 'a wall', 'a door', 'a rug', 'a very normal floor'],
  spot: ['rug', 'fan', 'cushion', 'plant', 'lampshade'],
  dish: ['main dish', 'salad', 'dessert', 'casserole', 'dip'],
  ingredient: ['raisins', 'mystery meat', 'too much cilantro', 'glitter', 'a whole bay leaf'],
  venue: ['garage', 'basement', 'dorm', 'shed', 'attic'],
  smell: ['old decisions', 'damp regret', 'expired hope', 'gym socks', 'burnt toast'],
  alien: ['the Zorblaxians', 'a very polite armada', 'space customs', 'the void council', 'an angry moon'],
  shipPart: ['hull', 'warp core', 'life support', 'coffee replicator', 'shield array'],
  // Everything here has to survive "THEY ARE CHARGING {weapon}".
  weapon: ['plasma cannons', 'a tractor beam', 'the good torpedoes', 'an ion lance', 'a suspiciously large flashlight'],
  starport: ['the nebula', 'drydock', 'the summit', 'Mars orbit', 'the space wedding'],
  task: ['the Q3 deck', 'the migration', 'the rebrand', 'the roadmap', 'the synergy audit'],
  buzzword: ['circle back', 'leverage synergies', 'move the needle', 'touch base', 'align on optics'],
  dateThing: ['his mom', 'a printed spreadsheet', 'his pet lizard', 'three phones', 'a slideshow', 'coupons'],
  call: ['a foul', 'offside', 'a strike', 'traveling', 'a clean hit'],
  sport: ['hockey', 'soccer', 'basketball', 'cricket', 'curling'],
  tripThing: ['a beach', 'wifi', 'no relatives', 'free breakfast', 'a hot tub'],
  // Money-ish quantities only: both "a budget of {budget}" and "WAY over
  // {budget}" have to read.
  budget: ['forty dollars', 'one (1) coupon', 'tree fiddy', 'twelve bucks', 'a jar of dimes'],
  vacaSpot: ['Vegas', 'a haunted B&B', "your cousin's couch", 'a corn maze', 'Mars'],
  device: ['monitor', 'laptop', 'mouse', 'whole computer', 'stapler'],
  plusOne: ['your ex', 'the whole office', 'a clown', 'my fantasy team', 'the office raccoon'],
  oddDetail: ['missing garden gnome', 'extra spoon', 'second Tuesday', 'unmarked van', 'dog that knew'],
  petThing: ['my keys', 'a full glass', 'the remote', 'my phone', 'a lit candle'],
  treat: ['pancakes', 'dumplings', 'tacos', 'waffles', 'noodles'],
  gadget: ['toaster', 'robot vacuum', 'smart speaker', 'air fryer', 'doorbell camera'],
  plant: ['fern', 'cactus', 'basil plant', 'bonsai', 'succulent'],
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
      '{A} -> {B} (angry, point-other): your {evidence} is right there',
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
      "{C} -> {A} (wave): I'm the surprise. hi.",
      '{B} (laugh): incredible work, {A}',
      '{A}: everyone act natural',
      '{C} (coy): a bit late for that',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: everyone stack on me',
      "{B}: you're standing in the {hazard}",
      '{A} (bored): it is a cozy {hazard}',
      '{C} -> {A} (point-other): you are the {role}, {A}',
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
      '{C} (happy, point-self): I will investigate personally',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: the clue just says "{clue}"',
      '{B}: I did that, it is just {ceiling}',
      '{C} -> {A}: read it again, slowly',
      '{A} (coy): "{clue}"... in a metaphorical sense, maybe?',
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
  {
    cast: 3,
    lines: [
      "{A}: captain, we're being hailed by {alien}",
      "{B} (bored): ignore it, we're late for {starport}",
      '{C} (scared): the {shipPart} is at forty percent',
      '{A} -> {B}: {B}, they have {weapon}',
      '{B}: everyone has {weapon}',
      '{C} (shout): THEY ARE CHARGING {weapon}',
      '{B} (shrug): reverse the polarity or something',
    ],
  },
  {
    cast: 4,
    lines: [
      '{A} (wave): quick sync on {task}?',
      "{B}: it's 4:55 on a friday, {A}",
      "{A} (happy): love that energy, let's {buzzword}",
      '{C} -> {A}: what does {buzzword} even mean',
      "{D}: I've been on mute this whole time",
      "{A} (coy): let's take that offline",
      '{B} (bored): there is no offline, {A}',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: so the date is going... interestingly',
      '{B}: define interestingly',
      '{A} (scared): he brought {dateThing}',
      '{C} -> {A}: leave. right now.',
      "{A} (coy): but he's kind of funny",
      '{B} (shout): HE BROUGHT {dateThing}',
      '{C} (laugh): text us a code word, {A}',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: that ref is BLIND',
      '{B}: it was clearly {call}, {A}',
      '{A} (angry): it was NOT {call}',
      "{C}: I'm just here for the snacks",
      "{B} -> {A}: you don't even watch {sport}",
      '{A} (coy): I watch the vibes of {sport}',
      '{C} (laugh): the vibes are losing by twenty',
    ],
  },
  {
    cast: 4,
    lines: [
      '{A}: okay, where are we going for the trip',
      '{B}: somewhere with {tripThing}',
      '{C} -> {A}: I can only do a budget of {budget}',
      '{D}: I am just happy to be included',
      '{A} (coy): what if we went to {vacaSpot}',
      '{B} (scared): that is WAY over {budget}',
      '{D} (happy): I will bring snacks either way',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A} (whisper): did you hear that',
      "{B} (whisper): it's an old house, {A}",
      '{C}: the thermometer just dropped ten degrees',
      '{A} -> {C}: is that bad',
      '{C} (scared): that is historically bad',
      '{B}: it is probably just {harmless}',
      "{A} (shout): {harmless} DOESN'T WHISPER MY NAME",
    ],
  },
  {
    cast: 3,
    lines: [
      "{A}: IT, my {device} won't turn on",
      '{B}: is it plugged in',
      '{A} (coy): define plugged in',
      '{C} -> {A}: {A}, is the cord in the wall',
      '{A}: ...which wall',
      '{B} (bored): any wall, {A}',
      "{C} (laugh): we'll send someone, don't touch anything",
    ],
  },
  {
    cast: 4,
    lines: [
      '{A}: final headcount is due today',
      '{B}: can we invite {plusOne}',
      '{A} (angry): {plusOne} is not invited',
      '{C} -> {A}: what about the seating chart',
      '{A} (scared): do NOT mention the seating chart',
      '{D}: I just work here',
      '{B} (coy): so is that a yes on {plusOne}',
    ],
  },
  {
    cast: 3,
    lines: [
      "{A}: and that's when it gets really strange",
      '{B}: the strange part was the {oddDetail}?',
      '{A} (coy): no, the strange part is coming',
      "{C} -> {A}: it's been three hours, {A}",
      "{A} (happy): and we're just getting started",
      '{B} (bored): please get to the point',
      '{C} (laugh): the point left an hour ago',
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: our kids are DESTROYING out there',
      '{B}: they are losing six to nothing, {A}',
      '{A} (coy): morally, we are winning',
      "{C} -> {A} (point-other): that's your kid eating grass",
      '{A} (happy): he is a free spirit',
      '{B} (laugh): he is eating the grass',
      "{C}: at least someone's having fun",
    ],
  },
  {
    cast: 3,
    lines: [
      '{A}: okay everyone grab a box',
      '{B}: this one is labeled "misc" and weighs a ton',
      "{C} -> {A}: what's even IN the misc box",
      '{A} (coy): misc',
      "{B} (shout): IT'S ALL BOWLING BALLS",
      '{C} (laugh): why do you own {bignum} bowling balls',
      '{A} (shrug): for emergencies',
    ],
  },

  // --- Two-handers. The corpus's tightest jokes are 2-person; give the
  // generator that register too. ---
  {
    cast: 2,
    lines: [
      '{A}: your cat is staring at me again',
      '{B} (laugh): she likes you',
      '{A}: she has been staring for an hour',
      '{B} (coy): she REALLY likes you',
      '{A} (scared): she just knocked {petThing} off the table',
      '{B} (shrug): affection',
      '{A} (shout): SHE IS WINDING UP AGAIN',
    ],
  },
  {
    cast: 2,
    lines: [
      '{A} (wave): guess who is back in town',
      '{B} (happy): NO WAY. for how long',
      '{A}: two whole weeks',
      '{B}: cancel everything, we are getting {treat}',
      '{A} (laugh): it is 9am',
      '{B}: {treat} do not care what time it is',
      '{A} (smile): I missed you',
      '{B} (smile): missed you too. bring an appetite',
    ],
  },
  {
    cast: 2,
    lines: [
      '{A}: hi, I would like to return this {gadget}',
      '{B}: of course. what seems to be wrong with it',
      '{A} (coy): it is cursed',
      '{B} (bored): that is not one of the listed defects',
      '{A}: at night it starts {verb}',
      '{B} (scared): it is doing it right now',
      '{A} (laugh): so... store credit?',
    ],
  },
  {
    cast: 2,
    lines: [
      '{A}: I think my {plant} is dying',
      '{B}: when did you last water it',
      '{A} (think): define "last"',
      '{B} (angry): {A}',
      '{A} (point-self): I sang to it though',
      '{B} (laugh): it needs water, not a concert',
      '{A} (happy): a concert AND water. compromise.',
    ],
  },
  {
    cast: 2,
    lines: [
      '{A}: rate my parallel parking',
      '{B}: we are {bignum} feet from the curb',
      '{A} (coy): it is called defensive parking',
      '{B} -> {A} (point-other): a bus just honked at you',
      '{A} (shout): THE BUS DOES NOT KNOW MY JOURNEY',
      '{B} (laugh): the bus knows plenty, {A}',
    ],
  },
];

/** How often the roll returns a hand-written corpus conversation instead of a generated one. */
const CURATED_ODDS = 7; // ~1 in 7 — enough to surface curated gems without repeating them often

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
