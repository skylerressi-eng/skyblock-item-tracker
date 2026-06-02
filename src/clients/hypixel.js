import { config } from '../config.js';
import { getJson } from './http.js';

// ---- API key rotation -------------------------------------------------------
// Each Hypixel key has its own independent rate-limit budget, so we round-robin
// across all configured keys. Callers running in parallel can pin a lane via
// `keyIndex` so each lane consistently uses a different key.
let rrCursor = 0;
export function keyCount() {
  return config.hypixelApiKeys.length;
}
export function pickKey(keyIndex = null) {
  const keys = config.hypixelApiKeys;
  if (!keys.length) return null;
  if (keyIndex != null) return keys[((keyIndex % keys.length) + keys.length) % keys.length];
  const k = keys[rrCursor % keys.length];
  rrCursor = (rrCursor + 1) % keys.length;
  return k;
}
function requireKey(keyIndex) {
  const key = pickKey(keyIndex);
  if (!key) {
    const err = new Error('HYPIXEL_API_KEY not set');
    err.code = 'NO_KEY';
    throw err;
  }
  return key;
}

// Public Bazaar snapshot (no key required).
export function getBazaar() {
  return getJson(`${config.hypixelBase}/skyblock/bazaar`);
}

// One page of live Auction House listings (no key required).
//   { success, page, totalPages, totalAuctions, lastUpdated, auctions: [...] }
export function getAuctionsPage(page = 0) {
  return getJson(`${config.hypixelBase}/skyblock/auctions?page=${page}`);
}

// Recently ended auctions (no key required).
export function getAuctionsEnded() {
  return getJson(`${config.hypixelBase}/skyblock/auctions_ended`);
}

// SkyBlock profiles for a player — authoritative inventory source. Requires an
// API key. `keyIndex` pins which rotated key (lane) to use. Returns the
// profiles array (each with members keyed by uuid).
export async function getProfiles(uuid, keyIndex = null) {
  const key = requireKey(keyIndex);
  const data = await getJson(
    `${config.hypixelBase}/v2/skyblock/profiles?uuid=${encodeURIComponent(uuid)}`,
    { headers: { 'API-Key': key } },
  );
  if (!data || data.success === false) {
    throw new Error(`Hypixel error: ${(data && data.cause) || 'unknown'}`);
  }
  return data.profiles || [];
}

// A player's friends list — powers the friends-of-friends crawl chain. Requires
// an API key (there is no keyless way to read friends). Returns an array of the
// *other* party's undashed UUIDs.
export async function getFriendUuids(uuid, keyIndex = null) {
  const key = requireKey(keyIndex);
  const data = await getJson(
    `${config.hypixelBase}/v2/friends?uuid=${encodeURIComponent(uuid)}`,
    { headers: { 'API-Key': key } },
  );
  const records = (data && data.records) || [];
  const me = uuid.replace(/-/g, '').toLowerCase();
  const out = [];
  for (const r of records) {
    // The friend is whichever side isn't us.
    const other = (r.uuidReceiver || '').toLowerCase() === me ? r.uuidSender : r.uuidReceiver;
    if (other) out.push(other.replace(/-/g, '').toLowerCase());
  }
  return out;
}
