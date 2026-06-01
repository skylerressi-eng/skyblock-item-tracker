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

**📖 Full preloaded reference (which colours/items are exotic vs not):
[`docs/EXOTICS.md`](docs/EXOTICS.md)** — also served at `GET /api/reference` and
shown in the website's **Reference** panel.

Leather armour stores its colour as an integer in NBT (`tag.display.color`). An
**exotic** is a colourable piece whose colour **can't be obtained today** (OG
pre-Nov-2019 dyeing, crafted, or glitched). The community rule — which this
engine implements — is:

```
colourable piece
  ├─ has a modern dye_item?            → NOT exotic
  ├─ colour == its default/factory?    → NOT exotic
  ├─ colour on the Crystal/Fairy chart → NOT exotic   ← Crystal & Fairy are NOT exotic
  └─ otherwise (off-chart colour)      → EXOTIC ✓
```

So detection works on **any colourable item**, not just a hardcoded list. The
engine:

1. **Skips modern-dye pieces** (`ExtraAttributes.dye_item`).
2. **Knows factory defaults** — preloaded in
   [`default-colors.json`](src/data/default-colors.json) (e.g. Magma `#ff9300`)
   *and* learned empirically (modal colour per item in the `piece_colors` table;
   learned wins once confident).
3. **Excludes known dyes** — the full Crystal (16) + Fairy (24) hex charts in
   [`known-dyes.json`](src/data/known-dyes.json). These are explicitly **not**
   exotic.
4. **Flags everything else off-default** as exotic and sub-classifies the likely
   origin (`PURE`, `TRUE_BLACK`, `CRAFTED`, `OG_DYED`, `GLITCHED`) — see
   [`exotic-families.json`](src/data/exotic-families.json). Confidence is **high**
   for a known family / learned-default mismatch, **medium** when only a
   preloaded/vanilla default is known.

### Other categories
- **`special_rarity`** — items whose tier is in `RARE_TIERS`
  (default `SPECIAL, VERY_SPECIAL`; tune via env).
- **`curated_rare` / `game_breaker`** — preloaded rare item IDs (Hyperion,
  Terminator, Cake Soul, Party Hats, …) in
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

**Every scan reads the whole account, not just the AH or equipped gear.** With
a key, a profile scan decodes *every* container — inventory, **ender chest,
backpacks, personal vault, wardrobe, accessory bags** — so forgotten exotics
sitting in storage are found too.

**Dormant / quit / banned hunting.** Each scan records the player's `last_save`
(last login). Accounts inactive for `DORMANT_DAYS` (default 365) are tagged
**dormant** — exactly where old exotics sit forgotten — and their friend circles
(same-era collectors) are prioritised in the crawl. (Note: Hypixel's API doesn't
expose a "banned" flag directly; long-dormant is the detectable proxy, and banned
accounts typically read as dormant.)

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
| `GET` | `/api/findings/:id` | Detail view: the finding + base (non-dyed) item price/history + colour population |
| `GET` | `/api/findings/by-hex/:hex` | Every finding sharing a colour + counts by item and owner |
| `GET` | `/api/crawl` | Crawler + queue status, recent activity |
| `POST` | `/api/crawl/enqueue` | Body `{username}` or `{uuid}` — add an account to the crawl |
| `POST` | `/api/crawl/seed` | Reload `seeds.json` into the queue |
| `GET` | `/api/prices/:item?span=day` | Current price + history (Coflnet, cached) |
| `GET` | `/api/reference` | Preloaded knowledge: exotic families, Crystal/Fairy charts, defaults, rare items |
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
  data/                exotic-families / known-dyes / default-colors / rare-items / seeds (editable)
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
