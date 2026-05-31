import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  uuid          TEXT PRIMARY KEY,
  username      TEXT,
  source        TEXT,
  first_seen    INTEGER,
  last_scanned  INTEGER,
  profile_count INTEGER DEFAULT 0,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key    TEXT UNIQUE,
  item_uuid    TEXT,
  item_id      TEXT,
  item_name    TEXT,
  rarity       TEXT,
  category     TEXT,
  subcategory  TEXT,
  hex          TEXT,
  confidence   TEXT,
  reason       TEXT,
  account_uuid TEXT,
  username     TEXT,
  profile_id   TEXT,
  profile_name TEXT,
  location     TEXT,
  source       TEXT,
  price        INTEGER,
  extra        TEXT,
  found_at     INTEGER,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_findings_cat   ON findings(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_findings_found ON findings(found_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_user  ON findings(username);

-- Empirically-learned "default" colour per piece: the modal colour is almost
-- certainly the legit default, so off-modal pieces are the exotics.
CREATE TABLE IF NOT EXISTS piece_colors (
  item_id TEXT,
  hex     TEXT,
  count   INTEGER DEFAULT 0,
  PRIMARY KEY (item_id, hex)
);

CREATE TABLE IF NOT EXISTS price_cache (
  item_id    TEXT,
  kind       TEXT,
  payload    TEXT,
  fetched_at INTEGER,
  PRIMARY KEY (item_id, kind)
);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT,
  uuid           TEXT,
  status         TEXT,
  message        TEXT,
  findings_count INTEGER DEFAULT 0,
  created_at     INTEGER,
  updated_at     INTEGER
);

-- The crawl frontier. Each row is an account to (re)scan. Keyed by uuid when
-- known, else by lowercased username, so we never enqueue the same target twice.
CREATE TABLE IF NOT EXISTS crawl_queue (
  key         TEXT PRIMARY KEY,     -- uuid (preferred) or 'name:<lowercased>'
  uuid        TEXT,
  username    TEXT,
  source      TEXT,                 -- seed | friend | ah | manual
  depth       INTEGER DEFAULT 0,    -- graph distance from a seed
  status      TEXT DEFAULT 'queued',-- queued | done | error
  priority    INTEGER DEFAULT 100,  -- lower = scanned sooner
  attempts    INTEGER DEFAULT 0,
  message     TEXT,
  enqueued_at INTEGER,
  scanned_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_queue_pick ON crawl_queue(status, priority, enqueued_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const now = () => Date.now();

export const repo = {
  // ---- accounts ---------------------------------------------------------
  upsertAccount({ uuid, username, source = 'manual', profileCount = 0, note = null }) {
    if (!uuid) return;
    getDb()
      .prepare(
        `INSERT INTO accounts (uuid, username, source, first_seen, last_scanned, profile_count, note)
         VALUES (@uuid, @username, @source, @t, @t, @profileCount, @note)
         ON CONFLICT(uuid) DO UPDATE SET
           username = COALESCE(excluded.username, accounts.username),
           last_scanned = excluded.last_scanned,
           profile_count = MAX(accounts.profile_count, excluded.profile_count),
           note = COALESCE(excluded.note, accounts.note)`,
      )
      .run({ uuid, username, source, profileCount, note, t: now() });
  },

  // ---- findings ---------------------------------------------------------
  insertFinding(f) {
    const t = now();
    const dedupKey = f.item_uuid
      ? `u:${f.item_uuid}:${f.category}:${f.subcategory || ''}`
      : `n:${f.account_uuid || '?'}:${f.item_id}:${f.hex || ''}:${f.category}:${f.subcategory || ''}`;
    const res = getDb()
      .prepare(
        `INSERT INTO findings
           (dedup_key, item_uuid, item_id, item_name, rarity, category, subcategory,
            hex, confidence, reason, account_uuid, username, profile_id, profile_name,
            location, source, price, extra, found_at, updated_at)
         VALUES
           (@dedup_key, @item_uuid, @item_id, @item_name, @rarity, @category, @subcategory,
            @hex, @confidence, @reason, @account_uuid, @username, @profile_id, @profile_name,
            @location, @source, @price, @extra, @found_at, @updated_at)
         ON CONFLICT(dedup_key) DO UPDATE SET
           item_name = excluded.item_name, rarity = excluded.rarity, hex = excluded.hex,
           confidence = excluded.confidence, reason = excluded.reason,
           subcategory = excluded.subcategory, account_uuid = excluded.account_uuid,
           username = excluded.username, profile_id = excluded.profile_id,
           profile_name = excluded.profile_name, location = excluded.location,
           source = excluded.source, price = excluded.price, extra = excluded.extra,
           updated_at = excluded.updated_at`,
      )
      .run({
        dedup_key: dedupKey,
        item_uuid: f.item_uuid || null,
        item_id: f.item_id || null,
        item_name: f.item_name || null,
        rarity: f.rarity || null,
        category: f.category,
        subcategory: f.subcategory || null,
        hex: f.hex || null,
        confidence: f.confidence || null,
        reason: f.reason || null,
        account_uuid: f.account_uuid || null,
        username: f.username || null,
        profile_id: f.profile_id || null,
        profile_name: f.profile_name || null,
        location: f.location || null,
        source: f.source || null,
        price: f.price ?? null,
        extra: f.extra ? JSON.stringify(f.extra) : null,
        found_at: t,
        updated_at: t,
      });
    return { isNew: res.changes === 1 && res.lastInsertRowid > 0, rowid: res.lastInsertRowid };
  },

  queryFindings({
    category, subcategory, confidence, source, q, username, since, limit = 60, offset = 0,
  } = {}) {
    const where = [];
    const p = {};
    if (category) { where.push('category = @category'); p.category = category; }
    if (subcategory) { where.push('subcategory = @subcategory'); p.subcategory = subcategory; }
    if (confidence) { where.push('confidence = @confidence'); p.confidence = confidence; }
    if (source) { where.push('source = @source'); p.source = source; }
    if (username) { where.push('username = @username'); p.username = username; }
    if (since) { where.push('found_at > @since'); p.since = Number(since); }
    if (q) {
      where.push('(username LIKE @q OR item_name LIKE @q OR item_id LIKE @q OR hex LIKE @q)');
      p.q = `%${q}%`;
    }
    p.limit = Math.min(Number(limit) || 60, 500);
    p.offset = Number(offset) || 0;
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return getDb()
      .prepare(`SELECT * FROM findings ${clause} ORDER BY found_at DESC LIMIT @limit OFFSET @offset`)
      .all(p)
      .map(hydrate);
  },

  latestFindingTs() {
    const row = getDb().prepare('SELECT MAX(found_at) m FROM findings').get();
    return (row && row.m) || 0;
  },

  // ---- learned piece colours -------------------------------------------
  recordPieceColor(itemId, hex) {
    if (!itemId || !hex) return;
    getDb()
      .prepare(
        `INSERT INTO piece_colors (item_id, hex, count) VALUES (?, ?, 1)
         ON CONFLICT(item_id, hex) DO UPDATE SET count = count + 1`,
      )
      .run(itemId, hex);
  },

  getDefaultHex(itemId) {
    if (!itemId) return null;
    const row = getDb()
      .prepare('SELECT hex, count FROM piece_colors WHERE item_id = ? ORDER BY count DESC LIMIT 1')
      .get(itemId);
    if (row && row.count >= config.pieceColorMinSamples) return row.hex;
    return null;
  },

  // ---- price cache ------------------------------------------------------
  getCachedPrice(itemId, kind) {
    const row = getDb()
      .prepare('SELECT payload, fetched_at FROM price_cache WHERE item_id = ? AND kind = ?')
      .get(itemId, kind);
    if (!row) return null;
    if (now() - row.fetched_at > config.priceCacheTtlMs) return null;
    try { return JSON.parse(row.payload); } catch { return null; }
  },

  setCachedPrice(itemId, kind, payload) {
    getDb()
      .prepare(
        `INSERT INTO price_cache (item_id, kind, payload, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(item_id, kind) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .run(itemId, kind, JSON.stringify(payload), now());
  },

  // ---- scan jobs --------------------------------------------------------
  createScanJob(username) {
    const t = now();
    const res = getDb()
      .prepare(
        `INSERT INTO scan_jobs (username, status, message, created_at, updated_at)
         VALUES (?, 'pending', 'queued', ?, ?)`,
      )
      .run(username, t, t);
    return res.lastInsertRowid;
  },

  updateScanJob(id, fields) {
    const allowed = ['uuid', 'status', 'message', 'findings_count'];
    const sets = [];
    const p = { id, updated_at: now() };
    for (const k of allowed) if (k in fields) { sets.push(`${k} = @${k}`); p[k] = fields[k]; }
    sets.push('updated_at = @updated_at');
    getDb().prepare(`UPDATE scan_jobs SET ${sets.join(', ')} WHERE id = @id`).run(p);
  },

  getScanJob(id) {
    return getDb().prepare('SELECT * FROM scan_jobs WHERE id = ?').get(id);
  },

  // ---- crawl queue ------------------------------------------------------
  // Enqueue an account. Idempotent on uuid (or name when uuid unknown). Won't
  // resurrect a 'done' row unless it's old enough to warrant a re-scan.
  enqueue({ uuid = null, username = null, source = 'manual', depth = 0, priority = 100 }) {
    if (!uuid && !username) return { added: false };
    const key = uuid ? uuid.toLowerCase() : `name:${username.toLowerCase()}`;
    const t = now();
    const d = getDb();
    // better-sqlite3 is synchronous, so check-then-act is race-free here and
    // lets us report `added` precisely (ON CONFLICT can't distinguish them).
    const existing = d.prepare('SELECT 1 FROM crawl_queue WHERE key = ?').get(key);
    if (!existing) {
      d.prepare(
        `INSERT INTO crawl_queue (key, uuid, username, source, depth, status, priority, enqueued_at)
         VALUES (@key, @uuid, @username, @source, @depth, 'queued', @priority, @t)`,
      ).run({ key, uuid, username, source, depth, priority, t });
      return { added: true, key };
    }
    // Already known: keep the best identity/priority, and requeue only if it
    // finished long enough ago to warrant a fresh scan.
    d.prepare(
      `UPDATE crawl_queue SET
         uuid = COALESCE(uuid, @uuid),
         username = COALESCE(username, @username),
         priority = MIN(priority, @priority),
         status = CASE
           WHEN status = 'done' AND (@t - COALESCE(scanned_at, 0)) > @rescan
             THEN 'queued' ELSE status END
       WHERE key = @key`,
    ).run({ key, uuid, username, priority, t, rescan: config.crawler.rescanAfterMs });
    return { added: false, key };
  },

  // Atomically claim a batch of queued accounts (mark them in-progress so
  // concurrent ticks don't double-scan). Returns the claimed rows.
  claimBatch(limit = 3) {
    const d = getDb();
    const claim = d.transaction((n) => {
      const rows = d
        .prepare(
          `SELECT * FROM crawl_queue WHERE status = 'queued'
           ORDER BY priority ASC, enqueued_at ASC LIMIT ?`,
        )
        .all(n);
      const mark = d.prepare(`UPDATE crawl_queue SET status = 'scanning' WHERE key = ?`);
      for (const r of rows) mark.run(r.key);
      return rows;
    });
    return claim(limit);
  },

  finishCrawl(key, { uuid = null, username = null, status = 'done', message = null } = {}) {
    getDb()
      .prepare(
        `UPDATE crawl_queue SET status = @status, message = @message,
           uuid = COALESCE(@uuid, uuid), username = COALESCE(@username, username),
           attempts = attempts + 1, scanned_at = @t WHERE key = @key`,
      )
      .run({ key, uuid, username, status, message, t: now() });
  },

  queueStats() {
    const d = getDb();
    const rows = d.prepare('SELECT status, COUNT(*) c FROM crawl_queue GROUP BY status').all();
    const out = { queued: 0, scanning: 0, done: 0, error: 0, total: 0 };
    for (const r of rows) { out[r.status] = r.c; out.total += r.c; }
    return out;
  },

  queuedCount() {
    return getDb()
      .prepare("SELECT COUNT(*) c FROM crawl_queue WHERE status IN ('queued','scanning')")
      .get().c;
  },

  recentCrawl(limit = 12) {
    return getDb()
      .prepare(
        `SELECT username, uuid, source, status, message, scanned_at
         FROM crawl_queue WHERE scanned_at IS NOT NULL
         ORDER BY scanned_at DESC LIMIT ?`,
      )
      .all(limit);
  },

  // ---- meta -------------------------------------------------------------
  getMeta(key, fallback = null) {
    const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : fallback;
  },
  setMeta(key, value) {
    getDb()
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  },

  // ---- stats ------------------------------------------------------------
  stats() {
    const d = getDb();
    const totalFindings = d.prepare('SELECT COUNT(*) c FROM findings').get().c;
    const totalAccounts = d.prepare('SELECT COUNT(*) c FROM accounts').get().c;
    const byCategory = d
      .prepare('SELECT category, COUNT(*) c FROM findings GROUP BY category ORDER BY c DESC')
      .all();
    const bySubcategory = d
      .prepare('SELECT category, subcategory, COUNT(*) c FROM findings GROUP BY category, subcategory ORDER BY c DESC')
      .all();
    return { totalFindings, totalAccounts, byCategory, bySubcategory };
  },
};

function hydrate(row) {
  if (row && row.extra) {
    try { row.extra = JSON.parse(row.extra); } catch { /* leave as string */ }
  }
  return row;
}
