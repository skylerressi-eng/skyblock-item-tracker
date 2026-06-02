import { normHex, dist } from './colors.js';
import { config } from '../config.js';
import {
  families, knownDyes, preloadedDefaultHex, hasPreloadedDefault,
  isRandomDyed, isAnimated, isTieredColor,
} from './data.js';

// Below this AH price (coins), an UNCONFIRMED exotic (no exact family match and
// no learned default) is almost certainly a baseline-colour false positive —
// nobody lists a genuine exotic for pocket change. Confirmed exotics (exact
// PURE/family match, or off a learned default) bypass this.
const MIN_EXOTIC_PRICE = config.minExoticPrice;

// How many times a colour must be the modal colour for a piece before we trust
// it as that piece's natural baseline (and suppress flagging it as exotic).
const DOMINANT_MIN_COUNT = 3;

// Common neutral leather colours that aren't exotics: vanilla undyed plus the
// dark/light greys plain leather oscillates between (report B). Kept tight so
// genuine True-Black (#000000–#131313 via the family list) still flags.
const NEUTRAL_LEATHER = new Set(['a06540', '191919', '1a1a1a', '808080', 'e5e533']);
function isNeutralLeatherColor(hex) {
  return NEUTRAL_LEATHER.has(normHex(hex));
}

// --- What counts as exotic? -------------------------------------------------
// An exotic is a colourable armour piece whose colour CANNOT be obtained today:
// OG-dyed (pre-Nov-2019 vanilla dyeing), crafted (e.g. True Black Necron/Storm),
// or glitched. The following are explicitly NOT exotic:
//   * undyed / vanilla leather (#a06540)
//   * pieces dyed with the modern dye system (ExtraAttributes.dye_item)
//   * Crystal- and Fairy-dyed colours (known, documented charts)
//   * a piece showing its own factory default colour
// So the rule is: off-default colour AND not a known dye  ->  exotic.

const FAMILY_FUZZY_THRESHOLD = 10; // RGB distance for a fuzzy exotic-family hit
const FAMILY_NAMES = Object.keys(families).filter((k) => !k.startsWith('_'));

// Default tag for an exotic colour that matches no specific family seed. OG dye
// (pre-Nov-2019 vanilla dyeing) is by far the most common such origin, so an
// off-default, non-Crystal/Fairy, non-random colour is tagged OG_DYED.
const GENERIC_EXOTIC_FAMILY = 'OG_DYED';
const KNOWN_DYE_NAMES = Object.keys(knownDyes).filter((k) => !k.startsWith('_'));
const KNOWN_DYE_TOLERANCE = Number(knownDyes._matchTolerance ?? 4);

// Is this hex a Crystal/Fairy (or other known, obtainable) dye colour?
// Returns the chart name (e.g. 'CRYSTAL', 'FAIRY') or null. Uses a small
// tolerance because client/render rounding can nudge a code by a point or two.
export function matchKnownDye(hex) {
  const h = normHex(hex);
  if (!h) return null;
  for (const name of KNOWN_DYE_NAMES) {
    for (const c of knownDyes[name] || []) {
      if (h === normHex(c)) return { name, exact: true };
    }
  }
  let best = null;
  for (const name of KNOWN_DYE_NAMES) {
    for (const c of knownDyes[name] || []) {
      const d = dist(h, c);
      if (best == null || d < best.d) best = { name, d };
    }
  }
  if (best && best.d <= KNOWN_DYE_TOLERANCE) return { name: best.name, exact: false };
  return null;
}

// Which exotic origin family does this hex look like? Falls back to OG_DYED
// (the classic exotic origin) when it matches no specific family seed.
export function classifyFamily(hex) {
  const h = normHex(hex);
  if (!h) return { name: GENERIC_EXOTIC_FAMILY, exact: false };

  for (const fam of FAMILY_NAMES) {
    if ((families[fam] || []).map(normHex).includes(h)) return { name: fam, exact: true };
  }
  let best = null;
  for (const fam of FAMILY_NAMES) {
    for (const c of families[fam] || []) {
      const d = dist(h, c);
      if (best == null || d < best.d) best = { name: fam, d };
    }
  }
  if (best && best.d <= FAMILY_FUZZY_THRESHOLD) return { name: best.name, exact: false };
  return { name: GENERIC_EXOTIC_FAMILY, exact: false };
}

// Classify a single item as exotic (or not). Works for ANY colourable item, not
// just items on a rare list.
//   item: normalized item (see items/extract.js)
//   ctx.getDefaultHex(itemId) -> learned default hex or null (empirical)
// Returns a finding fragment or null.
export function classifyExotic(item, { getDefaultHex, getDominantHex, price = null } = {}) {
  if (!item || !item.hex) return null; // only colourable (leather) armour has a colour
  const hex = normHex(item.hex);
  if (!hex) return null;

  // 1. Modern dye-system pieces are never exotic.
  if (item.extra && item.extra.dye_item) return null;

  // 1a. Tier/biome-coloured, non-dyeable sets (Frozen Blaze, Crimson Isle/
  // Kuudra, …) were added after dyeing was patched — any off-default colour is
  // a natural tier colour, never an exotic. Drop them.
  if (isTieredColor(item.itemId)) {
    return {
      category: 'tiered_color',
      subcategory: 'TIER',
      hex,
      confidence: 'low',
      reason: 'Tier/biome colour of a non-dyeable set (e.g. Frozen Blaze / Crimson Isle) — not a dye',
      priority: 2,
      drop: true,
    };
  }

  // 1b. Animated colour-cycle sets (e.g. Great/Greater Spook) show a live
  // animation frame, never a dye — every frame (incl. #000000) is a false
  // positive. Drop them so they aren't stored or learned from.
  if (isAnimated(item.itemId, hex)) {
    return {
      category: 'animated',
      subcategory: 'ANIMATED',
      hex,
      confidence: 'low',
      reason: 'Animated colour-cycle set (e.g. Great Spook) — colour is an animation frame, not a dye',
      priority: 1,
      drop: true,
    };
  }

  // 2. Resolve baselines. `learned` = confirmed modal colour (seen enough times);
  // `preloaded` = curated factory colour; `dominant` = the most-common colour
  // seen so far even before it's confirmed.
  const learned = getDefaultHex ? getDefaultHex(item.itemId) : null;
  const preloaded = hasPreloadedDefault(item.itemId) ? normHex(preloadedDefaultHex(item.itemId)) : null;
  const dominant = getDominantHex ? getDominantHex(item.itemId) : null;

  // 3. Showing a known baseline colour -> not exotic.
  if (learned && hex === normHex(learned)) return null;
  if (preloaded && hex === preloaded) return null;
  // 3b. ROOT-CAUSE FIX (report C/F): a piece whose colour IS the dominant colour
  // observed for that item is showing its natural baseline, NOT an exotic — even
  // before the default is formally "confirmed". This is what stops natural set
  // colours (Rancher's, Yog, Terror, Thunder, Mushroom #ff0000, …) being flagged
  // on first sight. Requires a little evidence so a single observation can't
  // self-justify.
  if (dominant && hex === normHex(dominant.hex) && dominant.count >= DOMINANT_MIN_COUNT) {
    return null;
  }

  // 4. Crystal/Fairy (or other known obtainable) dye -> NOT exotic.
  if (matchKnownDye(hex)) return null;

  // 5. Game-random-dyed set (Satin/Oxford/Velvet/Cashmere) -> not exotic.
  if (isRandomDyed(item.itemId)) {
    return {
      category: 'random_dyed', subcategory: 'RANDOM', hex, confidence: 'low',
      reason: 'Game-randomised colour (e.g. Satin/Oxford) — not a custom/OG exotic',
      priority: 5, drop: true,
    };
  }

  // 6. Vanilla/neutral leather greys (report B): plain leather is freely dyeable
  // and oscillates; common neutral greys are not exotics.
  if (isNeutralLeatherColor(hex) && !learned && !preloaded) return null;

  // 7. Cheap AH listings are baseline-colour fakes (report D/F), unless the
  // colour is a confirmed exotic family (handled below as high-confidence).
  const fam = classifyFamily(hex);
  const confirmed = fam.exact || Boolean(learned);
  if (!confirmed && price != null && price < MIN_EXOTIC_PRICE) {
    return {
      category: 'tiered_color', subcategory: 'CHEAP', hex, confidence: 'low',
      reason: `Off-default but listed for only ${price} coins — almost certainly a baseline/tier colour, not a real exotic`,
      priority: 2, drop: true,
    };
  }

  // 8. Classify the genuine exotic.
  if (fam.exact) {
    // Even an exact PURE/family match is suppressed if it's THIS piece's natural
    // dominant colour (e.g. Mushroom #ff0000 across many owners).
    if (dominant && hex === normHex(dominant.hex) && dominant.count >= DOMINANT_MIN_COUNT) return null;
    return {
      category: 'exotic', subcategory: fam.name, hex, confidence: 'high',
      reason: `Matches a known ${fam.name.replace('_', ' ')} exotic colour`, priority: 100,
    };
  }
  if (learned) {
    return {
      category: 'exotic', subcategory: fam.name, hex, confidence: 'high',
      reason: `Off-default colour (learned default #${learned}) — likely a genuine OG exotic`, priority: 80,
    };
  }
  if (preloaded) {
    // Off a curated factory default but not yet learned: medium confidence.
    return {
      category: 'exotic', subcategory: fam.name, hex, confidence: 'medium',
      reason: `Off the known default #${preloaded}, not a Crystal/Fairy dye — likely OG/glitched exotic`, priority: 50,
    };
  }
  // 9. No baseline of any kind yet (report F): SUPPRESS rather than flag-then-ask.
  // We still record the colour (caller does), so a real outlier surfaces once a
  // baseline exists. Returning null here is the core flood fix.
  return null;
}
