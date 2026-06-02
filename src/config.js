import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const bool = (v, d = false) =>
  v == null ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const list = (v, d = []) =>
  v == null ? d : String(v).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
// Split a comma/space-separated secret list, preserving original case.
const keyList = (v) =>
  v == null ? [] : String(v).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

// Accept either HYPIXEL_API_KEYS (plural, comma-separated) or the legacy
// singular HYPIXEL_API_KEY. De-duplicated, order preserved.
const apiKeys = [...new Set([
  ...keyList(process.env.HYPIXEL_API_KEYS),
  ...keyList(process.env.HYPIXEL_API_KEY),
])];

export const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'tracker.db'),

  // Hypixel API keys. With at least one we read full player inventories via
  // /v2/skyblock/profiles (the authoritative item source). Multiple keys are
  // rotated round-robin and run concurrently — each has its own rate limit, so
  // N keys ≈ N× the safe per-account throughput. Without any key we fall back
  // to the public SkyCrypt API (fewer items).
  hypixelApiKeys: apiKeys,
  // Back-compat alias: truthy when any key is configured; first key as a string.
  hypixelApiKey: apiKeys[0] || null,
  // Hypixel's per-key request limit (requests/minute). The client paces calls to
  // run just under this on EACH key, so total throughput ≈ keys × this.
  hypixelRatePerMin: Number(process.env.HYPIXEL_RATE_PER_MIN || 300),

  userAgent:
    process.env.USER_AGENT ||
    'skyblock-item-tracker/0.1 (+https://github.com/skylerressi-eng/skyblock-item-tracker)',

  // Rarity tiers treated as inherently notable. Defaults to the two genuinely
  // rare event/legacy tiers; LEGENDARY/MYTHIC are intentionally excluded as too
  // common. (Exotic-colour and curated game-breaker detection run regardless.)
  rareTiers: list(process.env.RARE_TIERS, ['SPECIAL', 'VERY_SPECIAL']),

  // How many copies of a piece we must see before we trust the learned
  // "default" colour. Until then, off-colour pieces are flagged low-confidence.
  pieceColorMinSamples: Number(process.env.PIECE_COLOR_MIN_SAMPLES || 4),

  // Random-dyed cosmetic sets (Satin/Oxford/Velvet/Cashmere — see
  // data/random-dyed.json) get a NEW random colour from the game, so they are
  // never real exotics. With this on (default), they are NOT stored at all and
  // existing ones are purged on startup. Set DROP_RANDOM_DYED=false to keep them
  // (filed under the low-priority 'random_dyed' category instead).
  dropRandomDyed: bool(process.env.DROP_RANDOM_DYED, true),

  // Price floor (coins) for UNCONFIRMED exotics found on the Auction House. An
  // off-default colour with no exact-family/learned-default match, listed below
  // this, is treated as a baseline-colour false positive (real exotics sell for
  // millions; nobody dumps one for 37 coins). 0 disables the floor.
  minExoticPrice: Number(process.env.MIN_EXOTIC_PRICE || 100000),

  // Endpoints
  hypixelBase: 'https://api.hypixel.net',
  coflnetBase: 'https://sky.coflnet.com/api',
  skycryptBase: 'https://sky.shiiyu.moe/api',
  mojangBase: 'https://api.mojang.com',
  ashconBase: 'https://api.ashcon.app/mojang/v2', // CORS-friendly Mojang mirror w/ name+uuid

  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
  priceCacheTtlMs: Number(process.env.PRICE_TTL_MS || 5 * 60 * 1000),

  // Background Auction House discovery worker. ON by default: the moment the
  // app starts it sweeps the live AH, decodes items, files rares/exotics, and
  // feeds every seller UUID into the crawl queue.
  ahWorker: {
    enabled: bool(process.env.AH_WORKER, true),
    intervalMs: Number(process.env.AH_INTERVAL_MS || 60_000),
    maxPagesPerCycle: Number(process.env.AH_MAX_PAGES || 5),
  },

  // Account crawler: drains a queue of accounts (seeds -> their friends ->
  // friends-of-friends [needs a key] + every AH seller), scanning each profile
  // and classifying its items. This is the engine behind "scan everyone".
  crawler: {
    enabled: bool(process.env.CRAWLER, true),
    intervalMs: Number(process.env.CRAWL_INTERVAL_MS || 1_000),
    batchSize: Number(process.env.CRAWL_BATCH || 40),
    // How many accounts to scan in PARALLEL per tick. A per-key rate limiter
    // paces the actual requests, so we can run several lanes per key without
    // overrunning the limit; this just bounds in-flight work. Defaults to
    // 3 lanes per key.
    concurrency: Number(process.env.CRAWL_CONCURRENCY || (apiKeys.length || 1) * 3),
    // Re-scan an account at most once per this window (avoid re-hammering).
    rescanAfterMs: Number(process.env.RESCAN_AFTER_MS || 6 * 60 * 60 * 1000),
    // Cap how many friends to enqueue per scanned account (graph fan-out).
    maxFriendsPerAccount: Number(process.env.MAX_FRIENDS || 30),
    // Stop auto-enqueuing AH sellers once the queue backlog exceeds this.
    maxQueueBacklog: Number(process.env.MAX_QUEUE_BACKLOG || 5000),
    // Retry an errored account up to this many attempts, waiting errorRetryMs
    // between tries — so transient timeouts/429s don't permanently kill a target.
    maxAttempts: Number(process.env.CRAWL_MAX_ATTEMPTS || 3),
    errorRetryMs: Number(process.env.CRAWL_ERROR_RETRY_MS || 10 * 60 * 1000),
    // Bootstrap the queue from src/data/seeds.json on first run.
    seedOnStart: bool(process.env.SEED_ON_START, true),
    // An account that hasn't logged in for this many days is "dormant" —
    // often quit/banned players whose old exotics are forgotten. We surface
    // these and prioritise their friend circles (same-era collectors).
    dormantDays: Number(process.env.DORMANT_DAYS || 365),
  },
};
