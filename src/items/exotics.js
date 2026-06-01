import { normHex, dist } from './colors.js';
import { families, knownDyes, preloadedDefaultHex, isRandomDyed } from './data.js';

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
export function classifyExotic(item, { getDefaultHex } = {}) {
  if (!item || !item.hex) return null; // only colourable (leather) armour has a colour
  const hex = normHex(item.hex);
  if (!hex) return null;

  // 1. Modern dye-system pieces are never exotic.
  if (item.extra && item.extra.dye_item) return null;

  // 2. Resolve this piece's default: empirically-learned wins, else preloaded.
  const learned = getDefaultHex ? getDefaultHex(item.itemId) : null;
  const def = learned || preloadedDefaultHex(item.itemId);

  // 3. Showing its own default colour -> not exotic.
  if (def && hex === normHex(def)) return null;

  // 4. Crystal/Fairy (or other known obtainable) dye -> NOT exotic.
  const known = matchKnownDye(hex);
  if (known) return null;

  // 5. Game-random-dyed set (e.g. Satin)? Off-default, but the colour is just a
  // random roll — NOT a genuine exotic. File it low-priority so it never floods
  // the feed above real exotics.
  if (isRandomDyed(item.itemId)) {
    return {
      category: 'random_dyed',
      subcategory: 'RANDOM',
      hex,
      confidence: 'low',
      reason: 'Game-randomised colour (e.g. Satin) — not a custom/OG exotic',
      priority: 5,
    };
  }

  // 6. Off-default and not a known dye -> EXOTIC. Sub-classify the origin.
  // `priority` floats genuine exotics to the top: exact family (PURE/TRUE_BLACK)
  // highest, then off-learned-default OG exotics, then unconfirmed.
  const fam = classifyFamily(hex);
  let confidence;
  let reason;
  let priority;
  if (fam.exact) {
    confidence = 'high';
    reason = `Matches a known ${fam.name.replace('_', ' ')} exotic colour`;
    priority = 100;
  } else if (learned) {
    confidence = 'high';
    reason = `Off-default colour (learned default #${learned}), not a Crystal/Fairy dye — likely a genuine OG exotic`;
    priority = 80;
  } else {
    // Off a *preloaded* default (or vanilla fallback) but not yet learned.
    confidence = 'medium';
    reason = `Off-default colour, not a Crystal/Fairy dye — likely OG/glitched exotic`;
    priority = 50;
  }

  return { category: 'exotic', subcategory: fam.name, hex, confidence, reason, priority };
}
