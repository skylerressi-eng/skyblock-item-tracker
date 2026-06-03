import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { repo } from '../db/index.js';
import { scanProfile } from './scanProfile.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let timer = null;
let running = false;
let authFailures = 0;   // consecutive auth/key failures (circuit breaker)
let pausedUntil = 0;    // crawler paused (ms epoch) after the breaker trips
const stats = { scanned: 0, findings: 0, enqueued: 0, errors: 0, lastError: null };
const errorKinds = {}; // human label -> count, so we can SEE what's failing
const startedAt = Date.now();
const recentScans = []; // timestamps of recent scans, for a rolling rate

// Bucket an error message into a diagnosable category.
function classifyError(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('403')) return 'blocked (403 — key invalid/unauthorized or network policy)';
  if (m.includes('429') || m.includes('throttle') || m.includes('rate')) return 'throttled (429)';
  if (m.includes('invalid api key') || m.includes('no_key') || m.includes('api key')) return 'bad/missing API key';
  if (m.includes('timed out') || m.includes('timeout') || m.includes('etimedout')) return 'timeout';
  if (m.includes('not found') || m.includes('404')) return 'player/profile not found';
  if (m.includes('enotfound') || m.includes('econnrefused') || m.includes('network') || m.includes('fetch failed')) return 'network unreachable';
  if (m.includes('502') || m.includes('503') || m.includes('cause')) return 'Hypixel API error';
  return 'other';
}
// True for failures caused by the API key / auth, not the target account.
function isAuthFailure(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('403') || m.includes('invalid api key') || m.includes('429')
    || m.includes('no_key') || m.includes('throttle');
}
function noteError(msg) {
  stats.errors++;
  stats.lastError = msg;
  const kind = classifyError(msg);
  errorKinds[kind] = (errorKinds[kind] || 0) + 1;
}

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
    pausedUntil: pausedUntil > Date.now() ? pausedUntil : null,
    concurrency: config.crawler.concurrency,
    keys: config.hypixelApiKeys.length,
    scansPerMin: recentScans.length, // accounts scanned in the last 60s
    errorKinds: { ...errorKinds }, // breakdown of WHY scans fail
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
    // scanProfile no longer throws on API failure — it returns mode 'failed'
    // with a warning. Treat that as an error so it's counted, diagnosed, and
    // retried, rather than silently marked done.
    if (res.mode === 'failed') {
      const w = res.warning || 'scan failed';
      noteError(w);
      // If the failure is an AUTH problem (bad/throttled key, 403), it is NOT
      // the account's fault — requeue it (don't burn the queue) and signal the
      // breaker so the crawler pauses instead of hammering a dead key.
      if (isAuthFailure(w)) {
        repo.requeueOne(row.key);
        authFailures++;
      } else {
        repo.finishCrawl(row.key, { status: 'error', message: w });
      }
      return 0;
    }
    authFailures = 0; // a success clears the breaker
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
    noteError(err.message);
    if (isAuthFailure(err.message)) { repo.requeueOne(row.key); authFailures++; }
    else repo.finishCrawl(row.key, { status: 'error', message: err.message });
    return 0;
  }
}

async function tick() {
  // Circuit breaker: if the API key keeps failing, PAUSE so we stop hammering
  // a dead/throttled key (which only makes Hypixel block it harder). The queue
  // is preserved (auth failures requeue), so work resumes once the key is fixed.
  if (Date.now() < pausedUntil) return;
  if (authFailures >= config.crawler.authFailPause) {
    pausedUntil = Date.now() + config.crawler.authPauseMs;
    authFailures = 0;
    console.warn(
      `[crawl] ⏸ pausing ${Math.round(config.crawler.authPauseMs / 1000)}s — API key keeps failing (403/invalid). ` +
      'Check your key with `npm run diagnose`. Queue is preserved.',
    );
    return;
  }
  if (running) return;
  running = true;
  try {
    let batch = repo.claimBatch(config.crawler.batchSize);
    if (!batch.length) {
      // Queue is empty (AH worker off or starved). Re-activate the oldest-scanned
      // accounts so the crawler can never sit permanently idle, then retry.
      const woke = repo.requeueOldestDone(config.crawler.batchSize);
      if (woke > 0) batch = repo.claimBatch(config.crawler.batchSize);
      if (!batch.length) return;
    }
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
    maybeHeartbeat();
  } catch (e) {
    noteError(e.message);
    console.error('[crawl] tick error:', e.message);
  } finally {
    running = false;
  }
}

// Every ~30s, print a one-line health summary so silent failures are visible.
let lastHeartbeat = 0;
function maybeHeartbeat() {
  const now = Date.now();
  if (now - lastHeartbeat < 30_000) return;
  lastHeartbeat = now;
  const q = repo.queueStats();
  const topErr = Object.entries(errorKinds).sort((a, b) => b[1] - a[1])[0];
  const errPart = stats.errors
    ? ` | errors ${stats.errors}` + (topErr ? ` (top: ${topErr[0]} ×${topErr[1]})` : '')
    : '';
  console.log(
    `[crawl] heartbeat — scanned ${stats.scanned} (${recentScans.length}/min), ` +
    `findings ${stats.findings}, queued ${q.queued}, scanning ${q.scanning}${errPart}`,
  );
  if (stats.errors && stats.scanned === 0 && stats.lastError) {
    console.warn(`[crawl] ⚠ all scans failing — last error: ${stats.lastError}`);
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
