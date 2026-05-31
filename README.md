# SkyBlock Rare & Exotic Item Tracker

A self-hosted web app that scans Hypixel SkyBlock players and the live Auction
House, **classifies rare and exotic items**, and stores every finding in a
searchable database.

Built around your priorities:

1. **Rare + exotic detection first.** The core is a classification engine that
   flags exotic leather-armour colours, special rarities, and curated
   "game-breaker" items.
2. **Discover accounts automatically.** A background **crawler** drains a queue
   of accounts — seed usernames → their friends (with a key) → every Auction
   House seller — scanning each profile and filing what it finds.
3. **The website updates itself.** A live dashboard streams new discoveries in
   as the crawler finds them — no refresh needed.

> ⚠️ **Read this first — two realities**
>
> 1. **Hypixel has no "list every player" API.** A profile scan needs a specific
>    username/UUID, so "scan everyone" is approximated by a crawl that keeps
>    discovering new accounts:
>    - **seed usernames** (`src/data/seeds.json`) — popular players to start from
>    - **friends-of-friends chain** — walks the social graph **(needs an API key;
>      Hypixel's friends endpoint is authenticated — there is no keyless way)**
>    - **Auction House sellers** — every active trader becomes a scan target
>      **(keyless; this is the main discovery engine without a key)**
> 2. **The data APIs must be reachable.** `api.hypixel.net`, `sky.coflnet.com`,
>    and `sky.shiiyu.moe` need to be reachable. Some sandboxes return HTTP 403;
>    on your own machine they work. Use `npm run seed` to explore the UI offline.

---

## Data sources

| Source | Used for | Key? |
| --- | --- | --- |
| [api.hypixel.net](https://api.hypixel.net) | Live AH (`/skyblock/auctions`) + Bazaar **(no key)**; **full inventories** (`/v2/skyblock/profiles`) and **friends** (`/v2/friends`) **(key)** | Mixed |
| [sky.coflnet.com](https://sky.coflnet.com) | Deepest free **price history** (~5y AH + Bazaar) | No |
| [sky.shiiyu.moe](https://sky.shiiyu.moe) (SkyCrypt) | Fallback profile/item source when no Hypixel key is set | No |
| Mojang / Ashcon | Username ⇄ UUID resolution | No |

---

## How exotic detection works

Leather armour stores its colour as an integer in NBT (`tag.display.color`).
"Exotics" are pieces whose hex colour can't be obtained normally (legacy dyes,
glitches, fairy/crystal colours, pure colours, etc.). The engine:

1. **Skips dyed items.** Anything with `ExtraAttributes.dye_item` was coloured
   with the modern dye system → not exotic.
2. **Learns each piece's default colour.** The modal colour seen across all
   scanned copies of an item is almost certainly its legit default (exotics are
   rare outliers). Stored in the `piece_colors` table and improves as you scan.
   No giant hardcoded colour list required.
3. **Flags off-default colours** as exotic, then **sub-classifies** them:
   - exact match in a known family (`PURE`, `CRYSTAL`, `FAIRY`, `OG_FAIRY`,
     `SPOOKY`, `BLEACHED`, `GLITCHED`) → that family, high confidence
   - off-default with a known default → high confidence, generic `EXOTIC`
   - off-default but default not yet learned → low confidence (needs more scans)

The family lists live in [`src/data/exotic-families.json`](src/data/exotic-families.json)
— `PURE` is complete; the others are small seeds you can expand from community
datasets for sharper sub-classification. The engine is correct with empty
families; it just labels more things generic `EXOTIC`.

### Other categories
- **`special_rarity`** — items whose tier is in `RARE_TIERS`
  (default `SPECIAL, VERY_SPECIAL`; tune via env).
- **`curated_rare` / `game_breaker`** — explicit item IDs you list in
  [`src/data/rare-items.json`](src/data/rare-items.json). Edit freely.

---

## How discovery works (the "scan everyone" engine)

A background **crawler** (`src/scanner/crawler.js`) drains a SQLite-backed
queue of accounts. Each tick it claims a small batch, scans those profiles,
files findings, and **enqueues newly-discovered accounts** — so the frontier
keeps growing on its own:

```
seeds.json ─┐
            ├─► crawl_queue ──► scan profile ──► classify ──► findings ──► live UI
AH sellers ─┤                        │
  friends ──┘◄───────────────────────┘  (friends needs a Hypixel key)
```

- **Seeds** — popular players in [`src/data/seeds.json`](src/data/seeds.json),
  loaded on boot (top priority).
- **Auction House sellers** — the AH worker feeds every seller UUID into the
  queue. **Keyless**, and the main engine when you have no API key.
- **Friends-of-friends** — with a key, each scanned account's friends are
  enqueued, walking the social graph outward from the seeds.

The queue is idempotent (no account is scanned twice within `RESCAN_AFTER_MS`)
and backlog-capped (`MAX_QUEUE_BACKLOG`) so it can run 24/7.

## Live updates

The site updates itself. The dashboard polls `/api/findings?since=<ts>` every
few seconds and prepends anything new (with a flash), and shows live engine
stats (queue depth, accounts crawled, AH worker state). Toggle it off with the
**Auto-updating** switch. This means: the crawler takes data → stores it → the
website reflects it, automatically.

---

## Quick start

```bash
npm install
npm test            # unit-test the engine + queue (no network) — 23 tests
npm run seed        # optional: sample findings to explore the UI offline
npm start           # http://localhost:3000  (AH worker + crawler start automatically)
```

To unlock full inventories + the friend-chain, add your free Hypixel key:

```bash
cp .env.example .env
# edit .env:  HYPIXEL_API_KEY=your-key-here
npm start
```

Everything runs locally — Node + SQLite, no cloud. Without a key it still works
(SkyCrypt fallback + AH-seller crawl); the key just makes it richer and turns on
friends-of-friends.

---

## HTTP API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/scan/:username` | Scan a player now, classify items, store findings |
| `GET` | `/api/findings` | Browse findings. Filters: `category, subcategory, confidence, source, q, username, since, limit, offset` (`since`=epoch ms powers live updates) |
| `GET` | `/api/crawl` | Crawler + queue status, recent activity |
| `POST` | `/api/crawl/enqueue` | Body `{username}` or `{uuid}` — add an account to the crawl |
| `POST` | `/api/crawl/seed` | Reload `seeds.json` into the queue |
| `GET` | `/api/prices/:item?span=day` | Current price + history (Coflnet, cached) |
| `GET` | `/api/stats` | DB counts, AH worker + crawler status, capability flags |
| `GET` | `/api/health` | Liveness |

---

## Project layout

```
src/
  config.js            env + constants
  db/index.js          SQLite schema + repo (findings, accounts, crawl_queue…)
  clients/             hypixel, coflnet, skycrypt, mojang, http
  items/
    nbt.js             base64+gzip+NBT  -> simplified items
    extract.js         simplified/SkyCrypt items -> common shape
    colors.js          hex/int/rgb helpers
    exotics.js         exotic colour engine  ◀ core
    rarity.js          tier + curated classification
    classify.js        run all classifiers
    data.js            load JSON datasets
  data/                exotic-families / dye-colors / rare-items / seeds (editable)
  scanner/
    scanProfile.js     scan one player (key path + SkyCrypt fallback, returns friends)
    crawler.js         queue-draining account crawler  ◀ discovery engine
    ahWorker.js        background Auction House sweep (feeds sellers to the crawler)
    context.js         shared classify context + finding builder
  routes/              scan, findings, crawl, prices, stats
  server.js            Express entry (starts AH worker + crawler)
public/                vanilla JS frontend (live feed, scan, browse, prices)
test/                  engine + NBT + queue unit tests (23)
scripts/seed-sample.js sample data for offline demo
```

---

## Roadmap / ideas
- Sync `exotic-families.json` from a community colour dataset for precise
  sub-categorisation (Crystal/Fairy/OG Fairy/etc.).
- Per-finding price estimates by joining the AH/Bazaar data.
- Persisted dedupe of "same exotic re-listed" across time.
- Server-Sent Events instead of polling for the live feed.

Not affiliated with Hypixel or Mojang. For educational/personal use; respect the
data providers' rate limits and terms.
