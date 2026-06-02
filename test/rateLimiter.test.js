import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyRateLimiter } from '../src/clients/rateLimiter.js';

test('rateLimiter: spaces requests on the same key', async () => {
  const rl = new KeyRateLimiter(600); // 0.9 safety -> ~111ms apart
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) await rl.acquire('K');
  const elapsed = Date.now() - t0;
  // 4 acquires = 3 gaps of ~111ms = ~333ms. Allow generous bounds.
  assert.ok(elapsed >= 250, `expected pacing, got ${elapsed}ms`);
  assert.ok(elapsed < 700, `too slow, got ${elapsed}ms`);
});

test('rateLimiter: different keys have independent budgets', async () => {
  const rl = new KeyRateLimiter(60); // 1s spacing per key
  const t0 = Date.now();
  // First acquire on each distinct key should be immediate.
  await Promise.all([rl.acquire('A'), rl.acquire('B'), rl.acquire('C')]);
  assert.ok(Date.now() - t0 < 50, 'first acquire per key should not wait');
});

test('rateLimiter: penalize pushes a key back', async () => {
  const rl = new KeyRateLimiter(6000); // ~10ms spacing — negligible
  rl.penalize('K', 200);
  const t0 = Date.now();
  await rl.acquire('K');
  assert.ok(Date.now() - t0 >= 150, 'penalised key should wait out the backoff');
});
