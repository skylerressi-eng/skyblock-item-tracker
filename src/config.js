import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const bool = (v, d = false) =>
  v == null ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const list = (v, d = []) =>
  v == null ? d : String(v).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'tracker.db'),

  // Optional Hypixel API key. With it we can read full player inventories via
  // /v2/skyblock/profiles (the authoritative item source). Without it we fall
  // back to the public SkyCrypt API, which exposes fewer items.
  hypixelApiKey: process.env.HYPIXEL_API_KEY || null,

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
    intervalMs: Number(process.env.CRAWL_INTERVAL_MS || 8_000),
    batchSize: Number(process.env.CRAWL_BATCH || 3),
    // Re-scan an account at most once per this window (avoid re-hammering).
    rescanAfterMs: Number(process.env.RESCAN_AFTER_MS || 6 * 60 * 60 * 1000),
    // Cap how many friends to enqueue per scanned account (graph fan-out).
    maxFriendsPerAccount: Number(process.env.MAX_FRIENDS || 30),
    // Stop auto-enqueuing AH sellers once the queue backlog exceeds this.
    maxQueueBacklog: Number(process.env.MAX_QUEUE_BACKLOG || 5000),
    // Bootstrap the queue from src/data/seeds.json on first run.
    seedOnStart: bool(process.env.SEED_ON_START, true),
  },
};
