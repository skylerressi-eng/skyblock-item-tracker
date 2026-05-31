import { config } from '../config.js';
import { getJson } from './http.js';

const isUuid = (s) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s);
const undash = (s) => String(s).replace(/-/g, '').toLowerCase();

// Resolve a username OR uuid to { uuid (undashed), username }.
// Uses Ashcon (handles both and returns name + uuid) with a Mojang fallback.
export async function resolvePlayer(input) {
  const q = String(input || '').trim();
  if (!q) throw new Error('empty player name');

  try {
    const data = await getJson(`${config.ashconBase}/user/${encodeURIComponent(q)}`);
    if (data && data.uuid) return { uuid: undash(data.uuid), username: data.username };
  } catch {
    /* fall through to Mojang */
  }

  if (isUuid(q)) {
    // Ashcon failed but we already have a uuid; return it (username unknown).
    return { uuid: undash(q), username: null };
  }
  const data = await getJson(`${config.mojangBase}/users/profiles/minecraft/${encodeURIComponent(q)}`);
  if (!data || !data.id) throw new Error(`player not found: ${q}`);
  return { uuid: undash(data.id), username: data.name };
}
