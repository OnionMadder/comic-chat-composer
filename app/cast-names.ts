/**
 * mComic '96 cast names — an app-only display overlay.
 *
 * The library and the faithful demo keep the original Microsoft Comic Chat
 * character names (Anna, Bolo, … and glenda's upstream "Greg" quirk). The
 * shipped app rebrands the cast with fresh names matched to each sprite's look,
 * keyed by the same internal character ids — so the composer, corpus,
 * share-links, and sprite lookups are all untouched; only the label changes.
 *
 * Renaming here (not in `assets/…/character.json`) is deliberate: it keeps the
 * reimplementation faithful and survives a sprite re-import.
 */
export const CAST_NAMES: Readonly<Record<string, string>> = {
  // People.
  anna: 'Cleo', // black Cleopatra bob, sultry
  armando: 'Dutch', // cowboy hat, shades, goatee
  bolo: 'Ren', // young Asian guy, jet-black hair, bolo tie
  cro: 'Thok', // caveman, unibrow, wild hair
  dan: 'Darnell', // round face, wholesome grin
  denise: 'Deja', // curly afro, hoop earrings
  lynnea: 'Roz', // curls, round shades, laughing
  margaret: 'Maude', // prim profile, cloud of curls
  mike: 'Murray', // weird mammal in a Shriner's fez
  susan: 'Poppy', // rounded bob, flower, wide-eyed
  tongtyed: 'Wally', // chubby, glasses, sheepish grin
  buck: 'Rusty', // spiky orange hair, freckles
  kevin: 'Kurt', // grunge slacker, messy mop
  kirby: 'Specs', // dark bob, big round glasses
  kwensa: 'Zola', // beaming face, striped headdress
  rebecca: 'Lola', // curly updo, flower, heavy-lidded
  sage: 'Cornelius', // scowling old man, beard + mane
  veronica: 'Roxy', // blonde ponytail, headband, sporty
  glenda: 'Dawn', // long flowing hair, hand on hip (fixes the "Greg" quirk, app-side)
  pedagog: 'Dean', // stern young man, crossed arms, tie
  tux: 'Miles', // skinny, nervous, tuxedo

  // Critters & oddballs.
  hugh: 'Reginald', // dignified bathrobe house-cat
  lance: 'Manila', // a paper bag with two eyes
  tiki: 'Totem', // carved tribal tiki mask
  xeno: 'Zeta', // grey alien, big black eyes
  maynard: 'Warren', // a rabbit (a warren is where they live)
  scotty: 'Jinx', // spiky black shadow-cat, glowing eyes
  connor: 'Frank', // tall standing sausage-creature
  jordan: 'Blinky', // blob covered in googly eyes, grass skirt
  rainbow: 'Riff', // an eel playing a snare drum
  waf: 'Newt', // pale salamander mid-croak
};

/** App display name for a character id, falling back to the manifest name / id. */
export function castName(id: string, fallback?: string): string {
  return CAST_NAMES[id] ?? fallback ?? id;
}
