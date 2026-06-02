import { config } from '../config.js';
import { getJson } from './http.js';

const isUuid = (s) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s);
const undash = (s) => String(s).replace(/-/g, '').toLowerCase();

// In-process name<->uuid cache so we never re-resolve the same handle. Mojang/
// Ashcon rate-limit hard, and the crawler revisits names constantly, so caching
// is what keeps us from drowning in 429/timeout errors.
const cache = new Map(); // lowercased input -> { uuid, username }
const MAX_CACHE = 50_000;
function remember(input, val) {
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(String(input).toLowerCase(), val);
  return val;
}

// Resolve a username OR uuid to { uuid (undashed), username }.
//   - A UUID resolves INSTANTLY with no external call — the Hypixel profiles
//     endpoint takes a uuid directly, so we don't need Mojang just for a name.
//     (The username gets filled in from profile data downstream when available.)
//   - A username uses Ashcon with a Mojang fallback, cached on success.
export async function resolvePlayer(input) {
  const q = String(input || '').trim();
  if (!q) throw new Error('empty player name');

  // Fast path: a UUID needs no network round-trip at all.
  if (isUuid(q)) return { uuid: undash(q), username: null };

  const hit = cache.get(q.toLowerCase());
  if (hit) return hit;

  try {
    const data = await getJson(`${config.ashconBase}/user/${encodeURIComponent(q)}`);
    if (data && data.uuid) return remember(q, { uuid: undash(data.uuid), username: data.username });
  } catch {
    /* fall through to Mojang */
  }
  const data = await getJson(`${config.mojangBase}/users/profiles/minecraft/${encodeURIComponent(q)}`);
  if (!data || !data.id) throw new Error(`player not found: ${q}`);
  return remember(q, { uuid: undash(data.id), username: data.name });
}
