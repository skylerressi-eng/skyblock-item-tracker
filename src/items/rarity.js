// Rarity-tier and curated-list classification.
import { isRarityExcluded } from './data.js';

export const TIER_ORDER = [
  'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY',
  'MYTHIC', 'DIVINE', 'SPECIAL', 'VERY_SPECIAL', 'ULTIMATE',
];

// Flag items whose rarity tier is in the configured "rare" set, unless the item
// is on the rarity-exclude list (over-common SPECIAL items, e.g. Kuudra Follower).
export function classifyRarity(item, { rareTiers = [] } = {}) {
  const r = (item.rarity || '').toUpperCase();
  if (!r) return null;
  if (!rareTiers.includes(r)) return null;
  if (isRarityExcluded(item.itemId)) return null;
  return {
    category: 'special_rarity',
    subcategory: r,
    confidence: 'high',
    reason: `${r.replace('_', ' ')} rarity item`,
  };
}

// Flag items that appear on the curated rare / game-breaker list.
export function classifyCurated(item, curatedIndex) {
  if (!curatedIndex || !item.itemId) return null;
  const hit = curatedIndex.get(item.itemId);
  if (!hit) return null;
  return {
    category: hit.category || 'curated_rare',
    subcategory: hit.subcategory || 'COLLECTOR',
    confidence: 'high',
    reason: hit.note || 'Curated rare item',
    label: hit.label || null,
  };
}
