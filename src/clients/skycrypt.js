import { config } from '../config.js';
import { getJson } from './http.js';

// SkyCrypt (sky.shiiyu.moe) public profile API. Shapes vary across deployments,
// so callers should treat the result defensively.
export function getProfile(username) {
  return getJson(`${config.skycryptBase}/v2/profile/${encodeURIComponent(username)}`);
}

// Walk an arbitrary SkyCrypt profile object and collect anything that looks like
// an item (carries an ExtraAttributes/tag or id+rarity/color). This is a
// best-effort extractor for when no Hypixel API key is configured.
export function collectItemsFromProfile(obj, out = [], depth = 0) {
  if (!obj || depth > 8) return out;
  if (Array.isArray(obj)) {
    for (const v of obj) collectItemsFromProfile(v, out, depth + 1);
    return out;
  }
  if (typeof obj !== 'object') return out;

  const looksLikeItem =
    (obj.tag && (obj.tag.ExtraAttributes || obj.tag.display)) ||
    (obj.id && (obj.rarity || obj.color || obj.display_name || obj.tier));
  if (looksLikeItem) out.push(obj);

  for (const v of Object.values(obj)) collectItemsFromProfile(v, out, depth + 1);
  return out;
}
