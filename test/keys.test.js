import { test } from 'node:test';
import assert from 'node:assert/strict';

// Configure keys BEFORE importing config (env is read at import time).
process.env.HYPIXEL_API_KEYS = 'KEY_A,KEY_B,KEY_C';
delete process.env.HYPIXEL_API_KEY;

const { config } = await import('../src/config.js');
const { pickKey, keyCount } = await import('../src/clients/hypixel.js');

test('keys: HYPIXEL_API_KEYS parses into a deduped list', () => {
  assert.deepEqual(config.hypixelApiKeys, ['KEY_A', 'KEY_B', 'KEY_C']);
  assert.equal(keyCount(), 3);
  assert.equal(config.hypixelApiKey, 'KEY_A', 'singular alias = first key');
});

test('keys: concurrency defaults to 1 lane per key (gentle, anti-burnout)', () => {
  assert.equal(config.crawler.concurrency, 3); // 3 keys × 1 lane
});

test('keys: pickKey() rotates round-robin', () => {
  const seq = [pickKey(), pickKey(), pickKey(), pickKey()];
  assert.deepEqual(seq, ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_A']);
});

test('keys: pickKey(index) pins a lane and wraps', () => {
  assert.equal(pickKey(0), 'KEY_A');
  assert.equal(pickKey(1), 'KEY_B');
  assert.equal(pickKey(2), 'KEY_C');
  assert.equal(pickKey(3), 'KEY_A', 'wraps modulo key count');
});
