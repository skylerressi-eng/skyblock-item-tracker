import { config } from '../config.js';
import { getJson } from './http.js';
import { KeyRateLimiter } from './rateLimiter.js';
import { canSpend, recordSpend, markDailyThrottled, budgetStatus } from '../scanner/budget.js';

// Paces requests to ~hypixelRatePerMin PER KEY so we run at the ceiling without
// 429s. Shared across all keyed calls.
const limiter = new KeyRateLimiter(config.hypixelRatePerMin);

const isDailyThrottle = (body) =>
  /daily/i.test(String((body && (body.cause || body.error)) || ''));

// Acquire a slot on `key`, fire the request, and on 429 back that key off and
// retry (honouring Retry-After when present). Every keyed call is gated by the
// daily budget guard so we never blow the account's daily request cap.
async function keyedGet(url, key, { attempts = 3 } = {}) {
  // Budget gate: refuse the request when the daily allowance is spent or paced
  // out, so the caller degrades instead of burning the cap.
  if (!canSpend()) {
    const s = budgetStatus();
    const err = new Error(
      s.spent
        ? `daily budget spent (${s.used}/${s.limit}); resets in ~${s.resetInHours}h`
        : `budget paced (used ${s.used}/${s.limit}); pausing to spread across the day`,
    );
    err.status = 429;
    err.budget = true;
    throw err;
  }
  for (let i = 0; ; i++) {
    await limiter.acquire(key);
    try {
      const out = await getJson(url, { headers: { 'API-Key': key } });
      recordSpend(1); // count a successful keyed request against today's budget
      return out;
    } catch (err) {
      // A DAILY throttle means the account's whole day is gone — mark it spent
      // so we stop immediately and don't waste retries.
      if (err.status === 429 && isDailyThrottle(err.body)) {
        markDailyThrottled();
        throw err;
      }
      if (err.status === 429 && i < attempts - 1) {
        const retryMs = Number(err.body && err.body.retryAfter) * 1000 || 2000 * (i + 1);
        limiter.penalize(key, retryMs);
        continue;
      }
      throw err;
    }
  }
}

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
  const data = await keyedGet(
    `${config.hypixelBase}/v2/skyblock/profiles?uuid=${encodeURIComponent(uuid)}`,
    key,
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
  const data = await keyedGet(
    `${config.hypixelBase}/v2/friends?uuid=${encodeURIComponent(uuid)}`,
    key,
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
