import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the DB at a throwaway file BEFORE importing the repo (config reads env
// at import time).
const tmpDb = path.join(os.tmpdir(), `tracker-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

const { repo, getDb } = await import('../src/db/index.js');

// Each test starts from an empty queue so cross-test ordering can't leak.
beforeEach(() => getDb().exec('DELETE FROM crawl_queue'));

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch { /* ignore */ }
  }
});

test('queue: enqueue is idempotent on uuid (case-insensitive)', () => {
  const a = repo.enqueue({ uuid: 'AABBCC', source: 'seed', priority: 0 });
  const b = repo.enqueue({ uuid: 'aabbcc', source: 'ah', priority: 200 });
  assert.equal(a.added, true);
  assert.equal(b.added, false, 'same uuid should not re-add');
  assert.equal(repo.queueStats().queued, 1);
});

test('queue: enqueue keeps the lower (more urgent) priority', () => {
  repo.enqueue({ uuid: 'PRIO1', priority: 200 });
  repo.enqueue({ uuid: 'PRIO1', priority: 5 });
  const [row] = repo.claimBatch(1);
  assert.equal(row.priority, 5, 'second enqueue should lower the priority number');
});

test('queue: claimBatch returns lowest-priority first and marks them scanning', () => {
  repo.enqueue({ username: 'LowPrio', priority: 100 });
  repo.enqueue({ username: 'HighPrio', priority: 1 });
  const batch = repo.claimBatch(1);
  assert.equal(batch.length, 1);
  assert.equal(batch[0].username, 'HighPrio');
  assert.equal(repo.queueStats().scanning, 1);
  // A second claim must not re-hand the same row.
  const second = repo.claimBatch(1);
  assert.equal(second[0].username, 'LowPrio');
});

test('queue: finishCrawl records identity and marks done', () => {
  repo.enqueue({ username: 'FinishMe', priority: 2 });
  const [row] = repo.claimBatch(1);
  repo.finishCrawl(row.key, { uuid: 'deadbeef', username: 'FinishMe', status: 'done', message: 'ok' });
  const hit = repo.recentCrawl(5).find((r) => r.username === 'FinishMe');
  assert.ok(hit, 'finished row should appear in recentCrawl');
  assert.equal(hit.status, 'done');
});

test('queue: queuedCount counts queued + scanning only', () => {
  assert.equal(repo.queuedCount(), 0);
  repo.enqueue({ uuid: 'COUNTME', priority: 9 });
  assert.equal(repo.queuedCount(), 1);
  const [row] = repo.claimBatch(1); // now 'scanning' — still counts
  assert.equal(repo.queuedCount(), 1);
  repo.finishCrawl(row.key, { status: 'done' }); // 'done' — no longer counts
  assert.equal(repo.queuedCount(), 0);
});

test('findings: since filter returns only newer rows', () => {
  const t0 = repo.latestFindingTs();
  repo.insertFinding({
    item_uuid: 'q-1', item_id: 'X', item_name: 'X', category: 'exotic',
    subcategory: 'PURE', hex: '000000', confidence: 'high', source: 'test',
  });
  const newer = repo.queryFindings({ since: t0 });
  assert.ok(newer.some((f) => f.item_uuid === 'q-1'));
  assert.equal(repo.queryFindings({ since: repo.latestFindingTs() }).length, 0);
});

test('hexStats: aggregates a colour across DIFFERENT item types and owners', () => {
  const mk = (uuid, itemId, owner, user) => repo.insertFinding({
    item_uuid: uuid, item_id: itemId, item_name: itemId, category: 'exotic',
    subcategory: 'OG_DYED', hex: 'abcdef', confidence: 'high',
    account_uuid: owner, username: user, source: 'test',
  });
  mk('h-1', 'CRYSTAL_HELMET', 'own-1', 'Alice');
  mk('h-2', 'WISE_DRAGON_CHESTPLATE', 'own-1', 'Alice');
  mk('h-3', 'MAGMA_LEGGINGS', 'own-2', 'Bob');

  const s = repo.hexStats('#ABCDEF'); // case + '#' tolerant
  assert.equal(s.total, 3, 'counts every piece of the colour');
  assert.equal(s.distinctOwners, 2);
  assert.equal(s.byItem.length, 3, 'three different item types share the colour');
  assert.equal(s.byOwner.find((o) => o.username === 'Alice').c, 2);
});

test('getFinding + findingsByHex round-trip', () => {
  const { rowid } = repo.insertFinding({
    item_uuid: 'g-1', item_id: 'X', item_name: 'X', category: 'exotic',
    subcategory: 'PURE', hex: '00ff00', confidence: 'high', source: 'test',
  });
  const f = repo.getFinding(rowid);
  assert.equal(f.item_uuid, 'g-1');
  assert.ok(repo.findingsByHex('00ff00').some((r) => r.item_uuid === 'g-1'));
  assert.equal(repo.getFinding(999999), null);
});
