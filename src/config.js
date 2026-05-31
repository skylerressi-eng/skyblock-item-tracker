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

  // Rarity tiers treated as inherently notable. LEGENDARY is intentionally
  // excluded because it is extremely common.
  rareTiers: list(process.env.RARE_TIERS, ['MYTHIC', 'DIVINE', 'SPECIAL', 'VERY_SPECIAL']),

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

  // Background Auction House discovery worker.
  ahWorker: {
    enabled: bool(process.env.AH_WORKER, false),
    intervalMs: Number(process.env.AH_INTERVAL_MS || 60_000),
    maxPagesPerCycle: Number(process.env.AH_MAX_PAGES || 5),
  },
};
