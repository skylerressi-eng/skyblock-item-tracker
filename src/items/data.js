import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

export const families = read('exotic-families.json');      // exotic origin seeds
export const knownDyes = read('known-dyes.json');          // Crystal/Fairy = NOT exotic
export const defaultColors = read('default-colors.json');  // preloaded factory colours
export const randomDyed = read('random-dyed.json');        // game-random-dyed sets (Satin…)
export const animatedSets = read('animated-sets.json');    // animated colour-cycle sets (Great Spook)
export const tieredSets = read('tiered-color-sets.json');  // tier/biome-coloured, non-dyeable sets
export const rarityExclude = read('rarity-exclude.json');  // ids excluded from special_rarity
export const dyeColors = read('dye-colors.json');
export const rareItemsRaw = read('rare-items.json');

// Preloaded default hex for a piece id, or the vanilla-leather fallback.
export function preloadedDefaultHex(itemId) {
  if (itemId && Object.prototype.hasOwnProperty.call(defaultColors, itemId)) {
    return defaultColors[itemId];
  }
  return defaultColors._vanillaLeather || 'a06540';
}

// True only when there is an EXPLICIT curated default for this exact id (not the
// vanilla fallback). Used so we don't treat the generic leather colour as a
// per-piece baseline.
export function hasPreloadedDefault(itemId) {
  return Boolean(itemId && Object.prototype.hasOwnProperty.call(defaultColors, itemId));
}

export const RANDOM_DYED_PATTERNS = (randomDyed.patterns || []).map((s) => String(s).toUpperCase());

// True if the item id belongs to a set the GAME dyes randomly (e.g. Satin).
// Such pieces are NOT genuine exotics — their off-default colour is just a roll.
export function isRandomDyed(itemId) {
  if (!itemId) return false;
  const id = String(itemId).toUpperCase();
  return RANDOM_DYED_PATTERNS.some((p) => id.includes(p));
}

export const TIERED_SET_PATTERNS = (tieredSets.patterns || []).map((s) => String(s).toUpperCase());
export const RARITY_EXCLUDE_PATTERNS = (rarityExclude.patterns || []).map((s) => String(s).toUpperCase());

// True if a piece should be excluded from special_rarity flagging (over-common
// SPECIAL items like Kuudra Follower).
export function isRarityExcluded(itemId) {
  if (!itemId) return false;
  const id = String(itemId).toUpperCase();
  return RARITY_EXCLUDE_PATTERNS.some((p) => id.includes(p));
}

// True if the item id belongs to a tier/biome-coloured, non-dyeable set (e.g.
// Frozen Blaze, Crimson Isle/Kuudra armour). Added after dyeing was patched, so
// any off-default colour is a natural tier colour, never an OG exotic.
export function isTieredColor(itemId) {
  if (!itemId) return false;
  const id = String(itemId).toUpperCase();
  return TIERED_SET_PATTERNS.some((p) => id.includes(p));
}

// Animated sets: id-substring patterns + the set of all known frame hexes.
// PURE_COLORS are colours (like #000000) that are ALSO legitimate exotics, so a
// frame-hex match on them must NOT alone mark an item animated — otherwise we'd
// wrongly exclude real True-Black pieces. Those require an id-pattern match.
const ANIMATED_PATTERNS = [];
const ANIMATED_FRAMES = new Set();
const PURE_COLORS = new Set([
  '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', '00ffff', 'ff00ff',
]);
for (const s of animatedSets.sets || []) {
  for (const p of s.idPatterns || []) ANIMATED_PATTERNS.push(String(p).toUpperCase());
  for (const h of s.frames || []) ANIMATED_FRAMES.add(String(h).toLowerCase().replace(/^#/, ''));
}
// Distinctive frames = frames that aren't also a plain pure colour. Matching one
// of these on any id is a safe animated signal; pure-colour frames are not.
const ANIMATED_DISTINCTIVE_FRAMES = new Set([...ANIMATED_FRAMES].filter((h) => !PURE_COLORS.has(h)));
export { ANIMATED_PATTERNS, ANIMATED_FRAMES, ANIMATED_DISTINCTIVE_FRAMES };

// True if a piece belongs to an animated colour-cycle set (e.g. Great Spook).
//  - id matches an animated set pattern -> always animated (any frame, incl. pure)
//  - otherwise, a DISTINCTIVE (non-pure) frame hex also counts, to catch
//    mis-typed ids — but a bare pure colour like #000000 does NOT, so genuine
//    True-Black exotics on normal pieces are preserved.
export function isAnimated(itemId, hex = null) {
  const id = String(itemId || '').toUpperCase();
  if (id && ANIMATED_PATTERNS.some((p) => id.includes(p))) return true;
  if (hex && ANIMATED_DISTINCTIVE_FRAMES.has(String(hex).toLowerCase().replace(/^#/, ''))) return true;
  return false;
}

// Build a Map<itemId, curatedEntry> from both curated lists.
export function buildCuratedIndex() {
  const m = new Map();
  const all = [...(rareItemsRaw.items || []), ...(rareItemsRaw.game_breakers || [])];
  for (const it of all) {
    if (!it.id || it.id === 'EXAMPLE_ITEM_ID') continue;
    m.set(it.id, it);
  }
  return m;
}
