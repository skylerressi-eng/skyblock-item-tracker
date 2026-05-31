import { config } from '../config.js';
import { getJson } from './http.js';
import { repo } from '../db/index.js';

// Coflnet has the deepest free history (~5y of AH + Bazaar). We cache responses
// in SQLite to be a good API citizen.

const tagOf = (itemId) => String(itemId || '').trim().toUpperCase();

export async function currentPrice(itemId) {
  const tag = tagOf(itemId);
  const cached = repo.getCachedPrice(tag, 'current');
  if (cached) return cached;
  const data = await getJson(`${config.coflnetBase}/item/price/${encodeURIComponent(tag)}/current`);
  repo.setCachedPrice(tag, 'current', data);
  return data;
}

// span: one of day | week | month | ...
export async function priceHistory(itemId, span = 'day') {
  const tag = tagOf(itemId);
  const kind = `history_${span}`;
  const cached = repo.getCachedPrice(tag, kind);
  if (cached) return cached;
  const data = await getJson(
    `${config.coflnetBase}/item/price/${encodeURIComponent(tag)}/history/${encodeURIComponent(span)}`,
  );
  repo.setCachedPrice(tag, kind, data);
  return data;
}
