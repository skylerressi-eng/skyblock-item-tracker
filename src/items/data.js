import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

export const families = read('exotic-families.json');      // exotic origin seeds
export const knownDyes = read('known-dyes.json');          // Crystal/Fairy = NOT exotic
export const defaultColors = read('default-colors.json');  // preloaded factory colours
export const randomDyed = read('random-dyed.json');        // game-random-dyed sets (Satin…)
export const dyeColors = read('dye-colors.json');
export const rareItemsRaw = read('rare-items.json');

// Preloaded default hex for a piece id, or the vanilla-leather fallback.
export function preloadedDefaultHex(itemId) {
  if (itemId && Object.prototype.hasOwnProperty.call(defaultColors, itemId)) {
    return defaultColors[itemId];
  }
  return defaultColors._vanillaLeather || 'a06540';
}

export const RANDOM_DYED_PATTERNS = (randomDyed.patterns || []).map((s) => String(s).toUpperCase());

// True if the item id belongs to a set the GAME dyes randomly (e.g. Satin).
// Such pieces are NOT genuine exotics — their off-default colour is just a roll.
export function isRandomDyed(itemId) {
  if (!itemId) return false;
  const id = String(itemId).toUpperCase();
  return RANDOM_DYED_PATTERNS.some((p) => id.includes(p));
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
