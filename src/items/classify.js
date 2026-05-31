import { classifyExotic } from './exotics.js';
import { classifyRarity, classifyCurated } from './rarity.js';

// Run every classifier against a normalized item. An item can land in multiple
// categories (e.g. an exotic piece that is also SPECIAL rarity).
//
//   item: normalized item (items/extract.js)
//   ctx:  { getDefaultHex, rareTiers, curatedIndex }
// Returns an array of finding fragments: { category, subcategory, hex?, confidence, reason }.
export function classifyItem(item, ctx = {}) {
  const out = [];
  const ex = classifyExotic(item, ctx);
  if (ex) out.push(ex);
  const ra = classifyRarity(item, ctx);
  if (ra) out.push(ra);
  const cu = classifyCurated(item, ctx.curatedIndex);
  if (cu) out.push(cu);
  return out;
}
