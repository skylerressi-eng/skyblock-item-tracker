import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { repo } from '../db/index.js';
import { scanProfile } from './scanProfile.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let timer = null;
let running = false;
const stats = { scanned: 0, findings: 0, enqueued: 0, errors: 0, lastError: null };
const startedAt = Date.now();
const recentScans = []; // timestamps of recent scans, for a rolling rate

function noteScan() {
  const now = Date.now();
  recentScans.push(now);
  // keep only the last 60s
  while (recentScans.length && now - recentScans[0] > 60_000) recentScans.shift();
}

export function getCrawlerStatus() {
  return {
    enabled: config.crawler.enabled,
    running,
    concurrency: config.crawler.concurrency,
    keys: config.hypixelApiKeys.length,
    scansPerMin: recentScans.length, // accounts scanned in the last 60s
    queue: repo.queueStats(),
    totals: { ...stats, uptimeSec: Math.round((Date.now() - startedAt) / 1000) },
    recent: repo.recentCrawl(8),
  };
}

// Load seed usernames and enqueue them at top priority. Safe to call repeatedly.
export function seedQueue() {
  let seeds = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'seeds.json'), 'utf8'));
    seeds = Array.isArray(raw.usernames) ? raw.usernames : [];
  } catch (e) {
    console.warn('[crawl] could not read seeds.json:', e.message);
  }
  let n = 0;
  for (const name of seeds) {
    const username = String(name || '').trim();
    if (!username) continue;
    if (repo.enqueue({ username, source: 'seed', depth: 0, priority: 0 }).added) n++;
  }
  if (n) console.log(`[crawl] seeded ${n} username(s)`);
  return n;
}

// Public helper for the AH worker: feed a discovered seller into the frontier
// (low priority so seeds/friends are scanned first). Respects a backlog cap so
// the queue can't grow without bound.
export function enqueueSeller(uuid) {
  if (!uuid) return false;
  if (repo.queuedCount() >= config.crawler.maxQueueBacklog) return false;
  const r = repo.enqueue({ uuid, source: 'ah', depth: 0, priority: 200 });
  if (r.added) stats.enqueued++;
  return r.added;
}

// Scan a single queued account, store findings, and chain its friends.
// `keyIndex` pins which rotated API key this lane uses (for parallel batches).
async function processOne(row, keyIndex = null) {
  const handle = row.uuid || row.username;
  try {
    const res = await scanProfile(handle, { source: row.source || 'crawl', keyIndex });
    stats.scanned++;
    noteScan();
    stats.findings += res.newFindings;

    // Chain friends-of-friends (only populated when a Hypixel key is set).
    // Dormant/banned players' friend circles are same-era collectors, so scan
    // them sooner (lower priority number).
    let chained = 0;
    const dormantBoost = res.dormant ? -30 : 0;
    for (const fuuid of res.friends || []) {
      if (chained >= config.crawler.maxFriendsPerAccount) break;
      if (repo.queuedCount() >= config.crawler.maxQueueBacklog) break;
      if (
        repo.enqueue({
          uuid: fuuid,
          source: res.dormant ? 'friend-dormant' : 'friend',
          depth: (row.depth || 0) + 1,
          priority: 50 + (row.depth || 0) * 10 + dormantBoost,
        }).added
      ) { chained++; stats.enqueued++; }
    }

    const tag = res.dormant ? ` DORMANT(${res.inactiveDays}d)` : '';
    repo.finishCrawl(row.key, {
      uuid: res.uuid,
      username: res.username,
      status: 'done',
      message: `${res.newFindings} new, ${res.itemsScanned} items, +${chained} friends [${res.mode}]${tag}`,
    });
    if (res.dormant) stats.dormantFound = (stats.dormantFound || 0) + 1;
    return res.newFindings;
  } catch (err) {
    stats.errors++;
    stats.lastError = err.message;
    repo.finishCrawl(row.key, { status: 'error', message: err.message });
    return 0;
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const batch = repo.claimBatch(config.crawler.batchSize);
    if (!batch.length) return;
    // Run up to `concurrency` accounts in parallel, each lane pinned to its own
    // API key (independent rate-limit budget). A shared cursor hands the next
    // queued row to whichever lane is free, so faster lanes aren't blocked.
    const lanes = Math.max(1, Math.min(config.crawler.concurrency, batch.length));
    let next = 0;
    let found = 0;
    const worker = async (laneKeyIndex) => {
      while (next < batch.length) {
        const row = batch[next++];
        found += await processOne(row, laneKeyIndex);
      }
    };
    await Promise.all(Array.from({ length: lanes }, (_, i) => worker(i)));
    if (found) console.log(`[crawl] batch of ${batch.length} (×${lanes} lanes) → ${found} new finding(s)`);
  } catch (e) {
    stats.errors++;
    stats.lastError = e.message;
    console.error('[crawl] tick error:', e.message);
  } finally {
    running = false;
  }
}

export function startCrawler() {
  if (!config.crawler.enabled || timer) return;
  if (config.crawler.seedOnStart) seedQueue();
  setTimeout(tick, 2000); // let the server bind + AH worker prime first
  timer = setInterval(tick, config.crawler.intervalMs);
  const nKeys = config.hypixelApiKeys.length;
  console.log(
    `[crawl] crawler enabled — batch ${config.crawler.batchSize}, ${config.crawler.concurrency} lane(s) every ${config.crawler.intervalMs}ms` +
      (nKeys ? ` (${nKeys} API key${nKeys > 1 ? 's' : ''}, friend-chain ON)` : ' (keyless: AH-seller chain only)'),
  );
}
