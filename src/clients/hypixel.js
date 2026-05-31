import { config } from '../config.js';
import { getJson } from './http.js';

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
// API key. Returns the profiles array (each with members keyed by uuid).
export async function getProfiles(uuid) {
  if (!config.hypixelApiKey) {
    const err = new Error('HYPIXEL_API_KEY not set');
    err.code = 'NO_KEY';
    throw err;
  }
  const data = await getJson(
    `${config.hypixelBase}/v2/skyblock/profiles?uuid=${encodeURIComponent(uuid)}`,
    { headers: { 'API-Key': config.hypixelApiKey } },
  );
  if (!data || data.success === false) {
    throw new Error(`Hypixel error: ${(data && data.cause) || 'unknown'}`);
  }
  return data.profiles || [];
}

// A player's friends list — powers the friends-of-friends crawl chain. Requires
// an API key (there is no keyless way to read friends). Returns an array of the
// *other* party's undashed UUIDs.
export async function getFriendUuids(uuid) {
  if (!config.hypixelApiKey) {
    const err = new Error('HYPIXEL_API_KEY not set');
    err.code = 'NO_KEY';
    throw err;
  }
  const data = await getJson(
    `${config.hypixelBase}/v2/friends?uuid=${encodeURIComponent(uuid)}`,
    { headers: { 'API-Key': config.hypixelApiKey } },
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
