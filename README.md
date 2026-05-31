# SkyBlock Rare & Exotic Item Tracker

A self-hosted web app that scans Hypixel SkyBlock players and the live Auction
House, **classifies rare and exotic items**, and stores every finding in a
searchable database.

Built around your two priorities:

1. **Rare + exotic detection first.** The core is a classification engine that
   flags exotic leather-armour colours, special rarities, and curated
   "game-breaker" items.
2. **Two ways to discover items:** type a username (on-demand scan) **and** an
   optional background worker that sweeps the live Auction House.

> ⚠️ **Read this first — two realities**
>
> 1. **Hypixel has no "list every player" API.** A profile scan needs a specific
>    username/UUID. So "scan everyone" is done two ways here: (a) you type names,
>    and (b) the AH worker discovers accounts + items from what's actively being
>    traded (the auctions endpoint exposes seller UUIDs **and** full item NBT).
> 2. **The data APIs may be blocked by your network.** `api.hypixel.net`,
>    `sky.coflnet.com`, and `sky.shiiyu.moe` must be reachable for live scans. In
>    some sandboxes they return HTTP 403. If so, run locally or allow those
>    domains. Use `npm run seed` to populate sample data and explore the UI
>    offline.

---

## Data sources

| Source | Used for | Key? |
| --- | --- | --- |
| [api.hypixel.net](https://api.hypixel.net) | Live AH (`/skyblock/auctions`), Bazaar, and **full player inventories** (`/v2/skyblock/profiles`, decoded from NBT here) | Bazaar/AH: no. Profiles: yes |
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
  (default `MYTHIC, DIVINE, SPECIAL, VERY_SPECIAL`; `LEGENDARY` is excluded as
  too common).
- **`curated_rare` / `game_breaker`** — explicit item IDs you list in
  [`src/data/rare-items.json`](src/data/rare-items.json). Edit freely.

---

## Quick start

```bash
npm install
npm test            # unit-test the classification + NBT engine (no network)
npm run seed        # optional: insert sample findings to explore the UI offline
npm start           # http://localhost:3000
```

For full inventory scans, set a Hypixel key (see `.env.example`):

```bash
cp .env.example .env
# edit .env: HYPIXEL_API_KEY=...   and optionally AH_WORKER=true
npm start
```

Without a key, player scans use the SkyCrypt fallback (fewer items). The AH
worker and price history never need a key.

---

## HTTP API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/scan/:username` | Scan a player, classify items, store findings |
| `GET` | `/api/findings` | Browse findings. Filters: `category, subcategory, confidence, source, q, username, limit, offset` |
| `GET` | `/api/prices/:item?span=day` | Current price + history (Coflnet, cached) |
| `GET` | `/api/stats` | DB counts, AH worker status, capability flags |
| `GET` | `/api/health` | Liveness |

---

## Project layout

```
src/
  config.js            env + constants
  db/index.js          SQLite schema + repo (better-sqlite3)
  clients/             hypixel, coflnet, skycrypt, mojang, http
  items/
    nbt.js             base64+gzip+NBT  -> simplified items
    extract.js         simplified/SkyCrypt items -> common shape
    colors.js          hex/int/rgb helpers
    exotics.js         exotic colour engine  ◀ core
    rarity.js          tier + curated classification
    classify.js        run all classifiers
    data.js            load JSON datasets
  data/                exotic-families / dye-colors / rare-items (editable)
  scanner/
    scanProfile.js     on-demand player scan
    ahWorker.js        background Auction House sweep
  routes/              scan, findings, prices, stats
  server.js            Express entry
public/                vanilla JS frontend (scan, browse, prices)
test/                  engine + NBT unit tests
scripts/seed-sample.js sample data for offline demo
```

---

## Roadmap / ideas
- Sync `exotic-families.json` from a community colour dataset for precise
  sub-categorisation (Crystal/Fairy/OG Fairy/etc.).
- Per-finding price estimates by joining the AH/Bazaar data.
- Seed the AH worker's discovered usernames into the on-demand scan queue.
- Persisted dedupe of "same exotic re-listed" across time.

Not affiliated with Hypixel or Mojang. For educational/personal use; respect the
data providers' rate limits and terms.
