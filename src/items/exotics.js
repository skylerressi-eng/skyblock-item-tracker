import { normHex, dist } from './colors.js';
import { families } from './data.js';

// Vanilla undyed leather. A piece that still has this colour and no dye is just
// an undyed/never-coloured leather item, not an exotic.
const VANILLA_LEATHER = 'a06540';

// Max RGB distance for a fuzzy family match when there is no exact hit.
const FAMILY_FUZZY_THRESHOLD = 10;

const FAMILY_NAMES = Object.keys(families).filter((k) => !k.startsWith('_'));

// Decide which exotic family a hex belongs to.
//  - exact match in a family list  -> { name, exact: true }
//  - near a populated family list   -> { name, exact: false }
//  - otherwise                      -> { name: 'EXOTIC', exact: false }
export function classifyFamily(hex) {
  const h = normHex(hex);
  if (!h) return { name: 'EXOTIC', exact: false };

  for (const fam of FAMILY_NAMES) {
    const listed = (families[fam] || []).map(normHex);
    if (listed.includes(h)) return { name: fam, exact: true };
  }

  let best = null;
  for (const fam of FAMILY_NAMES) {
    for (const c of families[fam] || []) {
      const d = dist(h, c);
      if (best == null || d < best.d) best = { name: fam, d };
    }
  }
  if (best && best.d <= FAMILY_FUZZY_THRESHOLD) return { name: best.name, exact: false };
  return { name: 'EXOTIC', exact: false };
}

// Classify a single item as exotic (or not).
//   item: normalized item (see items/extract.js)
//   ctx.getDefaultHex(itemId) -> learned default hex or null
// Returns a finding fragment or null.
export function classifyExotic(item, { getDefaultHex } = {}) {
  if (!item || !item.hex) return null; // only leather armour carries a colour
  const hex = normHex(item.hex);
  if (!hex) return null;

  // Legitimately dyed with the SkyBlock dye system -> normal, not exotic.
  if (item.extra && item.extra.dye_item) return null;

  const def = getDefaultHex ? getDefaultHex(item.itemId) : null;

  // Matches its known/learned default, or is plain undyed leather -> not exotic.
  if (def && hex === def) return null;
  if (!def && hex === VANILLA_LEATHER) return null;

  const fam = classifyFamily(hex);

  let confidence;
  let reason;
  if (fam.exact) {
    confidence = 'high';
    reason = `Matches a known ${fam.name} exotic colour`;
  } else if (def) {
    confidence = 'high';
    reason = `Off-default colour (this piece's default is #${def})`;
  } else {
    confidence = 'low';
    reason = 'Default colour not yet learned for this piece — scan more copies to confirm';
  }

  return {
    category: 'exotic',
    subcategory: fam.name,
    hex,
    confidence,
    reason,
  };
}
