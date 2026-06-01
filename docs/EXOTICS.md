# Rare & Exotic Reference

This is the preloaded knowledge the tracker uses to decide **what's exotic, what
isn't, and which items are rare.** All of it is editable JSON in
[`src/data/`](../src/data) and is also served live at `GET /api/reference` (and
shown in the website's **Reference** panel).

---

## What is an "exotic colour"?

> Exotics are SkyBlock armour pieces that were **dyed long ago in a way that's
> unobtainable today.** Undyed/brown leather is **not** exotic, and **Crystal-
> and Fairy-dyed armour is not exotic** either.

A piece carries a colour as an integer in its NBT (`tag.display.color`). To read
it in-game, press **F3 + H** to show hex codes under the item name.

**The rule the engine uses:**

```
colourable piece
  ├─ has a modern dye_item?            → NOT exotic (modern dye system)
  ├─ colour == its default/factory?    → NOT exotic
  ├─ colour on the Crystal/Fairy chart → NOT exotic (known, was obtainable)
  ├─ id is a random-dyed set (Satin…)  → random_dyed (downranked, NOT exotic)
  └─ otherwise (off-chart colour)      → EXOTIC ✓  (tagged OG_DYED by default)
```

So exotic detection works on **any colourable item**, not just a hardcoded list.

---

## ✓ EXOTIC — flagged (by likely origin)

| Family | What it is |
| --- | --- |
| **PURE** | Perfect RGB extremes (`#000000`, `#ffffff`, `#ff0000`, `#00ff00`, `#0000ff`, `#ffff00`, `#00ffff`, `#ff00ff`). Impossible via normal dyeing — always exotic. |
| **TRUE_BLACK** | Crafted Necron/Storm pieces that stayed near-black on Floor 7 release day. Famously valuable (True Black Storm chest: only one known). |
| **CRAFTED** | Colour retained from a crafting ingredient (e.g. early *yellow* Shark/Sharp pieces). Open list. |
| **OG_DYED** | Dyed before **Nov 2019** with the vanilla dye method — colours unreachable by Crystal/Fairy. The classic exotic sets below. Open list. |
| **GLITCHED** | Colour carried through an armour-upgrade glitch. Open list. |

"Open list" = there's no fixed chart; the engine flags these by them being
**off-default and not a known dye**. Any such unmatched exotic colour is tagged
**`OG_DYED`** (the classic exotic origin) — *medium* confidence, or *high* once
the piece's default colour is learned/preloaded.

### Classic exotic armour sets (community-known)
Magma (most common, cheapest), Lapis, the Dragon sets (Young, Old, Wise, Strong,
Unstable, Protector, **Superior** — *not* Holy), Tarantula (helmet/legs),
Tuxedo (very rare), Bat Person (one known). These are recognised automatically
when their colour is off-default and off-chart — you don't need them listed.

---

## 🚫 Random-dyed sets (Satin / Oxford / Velvet / Cashmere) — NOT exotic

Some cosmetic sets are dyed a **random colour by the game itself** on creation
(no two are alike). The colour is off-default and carries no `dye_item`, so a
naive detector mis-flags every one as a rare OG exotic and floods the feed.
Confirmed sets:

| Item | Slot |
| --- | --- |
| Velvet Top Hat | helmet |
| Cashmere Jacket | chestplate |
| Satin Trousers | leggings |
| Oxford Shoes | boots |

They're detected by item-id substring
([`random-dyed.json`](../src/data/random-dyed.json) — `SATIN`, `OXFORD`,
`VELVET`, `CASHMERE`). By default (`DROP_RANDOM_DYED=true`) the engine:

- **does not store** them at all (they're tagged `random_dyed` with `drop:true`),
- **never learns their colour** as a piece default (a random roll would
  otherwise poison the default and make the *next* roll look "off-default" — the
  original bug),
- **purges any already-stored** ones (and their poisoned colour defaults) on
  startup.

Set `DROP_RANDOM_DYED=false` to keep them instead — then they're filed under the
low-priority `random_dyed` category (hidden from the live feed, bottom of the
list, viewable via the **Random-dyed (Satin)** filter) rather than dropped.

Genuine exotics float to the top by priority: **PURE/TRUE_BLACK (100) >
learned-default OG (80) > unconfirmed OG (50) > … > random_dyed (5)**.

Add a set's id-substring to `random-dyed.json` to exclude it; remove one to
treat it normally.

---

## ✕ NOT exotic — never flagged

| Thing | Value(s) |
| --- | --- |
| **Undyed / vanilla leather** | `#a06540` |
| **Modern dye_item pieces** | any piece with `ExtraAttributes.dye_item` |
| **Piece showing its factory default** | see preloaded defaults below + learned defaults |
| **Crystal dye** (16 colours, by light level) | `#1f0030 #46085e #54146e #5d1c78 #63237d #6a2c82 #7e4196 #8e51a6 #9c64b3 #a875bd #b88bc9 #c6a3d4 #d9c1e3 #e5d1ed #efe1f5 #fcf3ff` |
| **Fairy dye** (24 colours, cycling) | `#660066 #660033 #99004c #cc0066 #ff007f #ff3399 #ff66b2 #ff99cc #ffcce5 #990099 #cc00cc #ff00ff #ff33ff #ff66ff #ff99ff #ffccff #e5ccff #cc99ff #b266ff #9933ff #7f00ff #6600cc #4c0099 #330066` |

Crystal/Fairy matching uses a tiny tolerance (±4 per channel) to absorb client
rounding. Edit these in
[`src/data/known-dyes.json`](../src/data/known-dyes.json).

### Preloaded piece defaults
[`src/data/default-colors.json`](../src/data/default-colors.json) seeds factory
colours so pieces aren't false-flagged before the crawler learns them. Magma is
preloaded at `#ff9300`; more get learned empirically as the crawler scans (the
modal colour per item id, stored in the `piece_colors` table — learned values
win once confident).

---

## ★ Rare ITEMS — flagged regardless of colour

Separate from colour detection. Edit in
[`src/data/rare-items.json`](../src/data/rare-items.json).

- **Special rarity tiers** (auto-flag into `special_rarity`): `SPECIAL`,
  `VERY_SPECIAL` (tune via `RARE_TIERS`).
- **Game breakers** — Hyperion, Valkyrie, Necron's Blade, Terminator, Daedalus
  Axe, Dark Claymore, Hegemony Artifact.
- **Collectors / cosmetics** — Cake Soul, Party Hats (Crab/Sloth), Balloon Hat,
  Rift Prism, DCTR's Space Helmet.

A single item can land in multiple buckets (e.g. an exotic-coloured piece that
is also `SPECIAL`).

---

## Confidence levels

| Confidence | Meaning |
| --- | --- |
| **high** | Matches a known exotic family colour, or is off a *learned* default and not a known dye. |
| **medium** | Off a *preloaded/vanilla* default and not a known dye — very likely OG/glitched, pending more samples. |

---

## Sources

Community definitions and hex charts were cross-checked across:

- [Guide to "Exotic Colored" armor — Hypixel Forums](https://hypixel.net/threads/guide-to-exotic-colored-armor-featured-in-50meter-midas-vid.3819580/)
- [Crystal/Fairy Dyed Sets — Hex Codes — Hypixel Forums](https://hypixel.net/threads/crystal-fairy-dyed-sets-hex-codes.4514145/)
- [Dyed Armor — Hypixel SkyBlock Wiki (Fandom)](https://hypixel-skyblock.fandom.com/wiki/Dyed_Armor)
- [LeaPhant's SkyBlock gist (Crystal/Fairy hex data used by SkyCrypt)](https://gist.github.com/LeaPhant/6b10170be581ee68eeb275ff8e5242b9)
- [Black Necron / Storm Armor — Hypixel Forums](https://hypixel.net/threads/black-necron-storm-armor.4584967/)
- Exotic armor overview video: https://www.youtube.com/watch?v=NYMPTb06z3w

> Prices and "one known" claims in the community guide are volatile/anecdotal and
> are **not** baked into detection — the engine classifies by colour origin and
> item id, not price.
