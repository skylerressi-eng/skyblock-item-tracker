import { config } from '../config.js';

// Small fetch wrapper: timeout, default headers, JSON parsing, useful errors.
export async function getJson(url, { headers = {}, timeout = config.requestTimeoutMs } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...headers },
      signal: ac.signal,
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Request timed out after ${timeout}ms: ${url}`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
