import { hexFromInt } from './colors.js';

const STRIP = /§[0-9a-fk-or]/gi; // Minecraft § colour/format codes

export function strip(s) {
  return (s == null ? '' : String(s)).replace(STRIP, '');
}

// Vanilla numeric ids for the colourable leather armour pieces (1.8 NBT).
const VANILLA_LEATHER_IDS = {
  298: 'LEATHER_HELMET',
  299: 'LEATHER_CHESTPLATE',
  300: 'LEATHER_LEGGINGS',
  301: 'LEATHER_BOOTS',
};

// Tier display variants -> canonical tier. Longer/more-specific first so that
// "VERY SPECIAL" is not matched as "SPECIAL".
const TIER_MATCHERS = [
  ['VERY SPECIAL', 'VERY_SPECIAL'],
  ['ULTIMATE', 'ULTIMATE'],
  ['DIVINE', 'DIVINE'],
  ['MYTHIC', 'MYTHIC'],
  ['LEGENDARY', 'LEGENDARY'],
  ['EPIC', 'EPIC'],
  ['SPECIAL', 'SPECIAL'],
  ['RARE', 'RARE'],
  ['UNCOMMON', 'UNCOMMON'],
  ['COMMON', 'COMMON'],
];

export function parseRarityFromLore(lore) {
  if (!Array.isArray(lore)) return null;
  // The rarity is on (or near) the last line. Scan from the bottom.
  for (let i = lore.length - 1; i >= 0 && i >= lore.length - 4; i--) {
    const line = strip(lore[i]).toUpperCase();
    for (const [needle, tier] of TIER_MATCHERS) {
      if (line.includes(needle)) return tier;
    }
  }
  return null;
}

// Normalize a simplified-NBT item into our common shape. Works for both
// inventory items (Hypixel profiles) and auction item_bytes.
export function normalizeNbtItem(raw, location = null) {
  if (!raw || (raw.id == null && !raw.tag)) return null;
  const tag = raw.tag || {};
  const ea = tag.ExtraAttributes || {};
  const display = tag.display || {};

  let hex = null;
  let colorInt = null;
  if (typeof display.color === 'number') {
    colorInt = display.color >>> 0;
    hex = hexFromInt(colorInt);
  }

  const itemId = ea.id || VANILLA_LEATHER_IDS[raw.id] || null;

  return {
    itemId,
    name: strip(display.Name) || itemId || 'Unknown',
    rarity: parseRarityFromLore(display.Lore),
    hex,
    colorInt,
    uuid: ea.uuid || null,
    count: raw.Count || 1,
    location,
    extra: ea,
    lore: Array.isArray(display.Lore) ? display.Lore.map(strip) : [],
  };
}

// Best-effort normalizer for items as exposed by the SkyCrypt API, whose exact
// shape varies. We try a few known field layouts and fall back to NBT-style.
export function normalizeSkycryptItem(raw, location = null) {
  if (!raw || typeof raw !== 'object') return null;

  // SkyCrypt often carries the original NBT tag through.
  if (raw.tag && (raw.tag.ExtraAttributes || raw.tag.display)) {
    const norm = normalizeNbtItem(raw, location);
    if (norm) return norm;
  }

  const ea = raw.extra || raw.ExtraAttributes || {};
  const itemId = raw.itemId || raw.id || ea.id || null;
  if (!itemId && !raw.display_name && !raw.color) return null;

  let hex = null;
  if (raw.color) hex = String(raw.color).toLowerCase().replace(/^#/, '');
  else if (typeof raw.colour === 'number') hex = hexFromInt(raw.colour);

  return {
    itemId,
    name: strip(raw.display_name || raw.name || itemId || 'Unknown'),
    rarity: (raw.rarity || raw.tier || '').toString().toUpperCase().replace(/[\s-]+/g, '_') || null,
    hex,
    colorInt: hex ? parseInt(hex, 16) : null,
    uuid: ea.uuid || raw.uuid || null,
    count: raw.Count || raw.count || 1,
    location,
    extra: ea,
    lore: Array.isArray(raw.lore) ? raw.lore.map(strip) : [],
  };
}
