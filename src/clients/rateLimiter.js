// Per-key request pacer. Hypixel allows ~300 requests/min PER KEY; exceeding it
// returns 429s that actually slow you down (and can get a key throttled). This
// reserves evenly-spaced time slots per key so we run right at the ceiling with
// zero overruns. Reservation is synchronous (no await between read+write of the
// slot), so it's race-free under Node's single-threaded model.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class KeyRateLimiter {
  constructor(ratePerMin = 300, { safetyFactor = 0.9 } = {}) {
    // Run slightly under the documented ceiling for headroom against clock skew
    // and the odd retried request.
    const effective = Math.max(1, ratePerMin * safetyFactor);
    this.intervalMs = 60_000 / effective;
    this.nextSlot = new Map(); // key -> earliest timestamp the next request may fire
  }

  // Reserve the next slot for `key` and resolve once it's time to fire.
  async acquire(key) {
    const id = key || '__nokey__';
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(id) || 0);
    this.nextSlot.set(id, slot + this.intervalMs);
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  }

  // Push a key's next slot out (e.g. after a 429) so we back off on it.
  penalize(key, ms) {
    const id = key || '__nokey__';
    this.nextSlot.set(id, Math.max(this.nextSlot.get(id) || 0, Date.now() + ms));
  }
}
