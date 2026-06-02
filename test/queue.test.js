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

test('queue: queuedCount counts only pending (queued) rows', () => {
  assert.equal(repo.queuedCount(), 0);
  repo.enqueue({ uuid: 'COUNTME', priority: 9 });
  assert.equal(repo.queuedCount(), 1);
  // Claimed (scanning) rows are NO LONGER counted — they're in-flight, not a
  // backlog, so they must not block the AH worker's enqueue cap.
  const [row] = repo.claimBatch(1);
  assert.equal(repo.queuedCount(), 0);
  repo.finishCrawl(row.key, { status: 'done' });
  assert.equal(repo.queuedCount(), 0);
});

test('queue: stranded scanning rows are recovered', () => {
  repo.enqueue({ uuid: 'STRANDED', priority: 1 });
  repo.claimBatch(1); // -> scanning
  assert.equal(repo.queueStats().scanning >= 1, true);
  const recovered = repo.requeueScanning();
  assert.ok(recovered >= 1);
  assert.equal(repo.queueStats().scanning, 0);
  assert.ok(repo.queuedCount() >= 1, 'recovered row is queued again');
});

test('queue: idle recovery re-queues oldest done accounts', () => {
  // Enqueue a known account, claim it, finish it as done, then confirm idle
  // recovery can wake it back to 'queued'.
  repo.enqueue({ uuid: 'IDLEWAKE', priority: 1 });
  repo.claimBatch(100); // moves it (and any others) to scanning
  repo.finishCrawl('idlewake', { status: 'done', uuid: 'IDLEWAKE' });
  const beforeQueued = repo.queuedCount();
  const woke = repo.requeueOldestDone(100);
  assert.ok(woke >= 1, 'should re-queue at least one done account');
  assert.ok(repo.queuedCount() > beforeQueued, 'a done row became queued again');
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

test('search: by exact colour, by item, and by state (enchanted/clean/reforged)', () => {
  repo.insertFinding({ item_uuid: 's-red', item_id: 'WISE_DRAGON_CHESTPLATE', item_name: 'Wise Chest', category: 'exotic', subcategory: 'PURE', hex: 'ff0000', enchanted: 1, source: 'test' });
  repo.insertFinding({ item_uuid: 's-blue', item_id: 'STRONG_DRAGON_BOOTS', item_name: 'Strong Boots', category: 'exotic', subcategory: 'OG_DYED', hex: '0000ff', reforge: 'fierce', source: 'test' });
  repo.insertFinding({ item_uuid: 's-clean', item_id: 'HYPERION', item_name: 'Hyperion', category: 'game_breaker', subcategory: 'WEAPON', hex: null, source: 'test' });

  // colour search is exact (and tolerant of '#')
  const red = repo.queryFindings({ color: '#FF0000' });
  assert.ok(red.some((r) => r.item_uuid === 's-red'));
  assert.ok(!red.some((r) => r.item_uuid === 's-blue'));

  // general colour-NAME search: "blue" matches the bluish piece, not the red one
  const blue = repo.queryFindings({ color: 'blue' });
  assert.ok(blue.some((r) => r.item_uuid === 's-blue'), 'blue name matches #0000ff');
  assert.ok(!blue.some((r) => r.item_uuid === 's-red'));

  // item search matches id or name
  assert.ok(repo.queryFindings({ item: 'dragon' }).length >= 2);
  assert.ok(repo.queryFindings({ item: 'HYPERION' }).some((r) => r.item_uuid === 's-clean'));

  // state filters
  assert.ok(repo.queryFindings({ state: 'enchanted' }).some((r) => r.item_uuid === 's-red'));
  assert.ok(repo.queryFindings({ state: 'reforged' }).some((r) => r.item_uuid === 's-blue'));
  const clean = repo.queryFindings({ state: 'clean' });
  assert.ok(clean.some((r) => r.item_uuid === 's-clean'));
  assert.ok(!clean.some((r) => r.item_uuid === 's-red'), 'enchanted item is not clean');
});
