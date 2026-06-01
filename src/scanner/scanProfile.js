import { config } from '../config.js';
import { repo } from '../db/index.js';
import { resolvePlayer } from '../clients/mojang.js';
import { getProfiles, getFriendUuids } from '../clients/hypixel.js';
import { getProfile, collectItemsFromProfile } from '../clients/skycrypt.js';
import { decodeInventory } from '../items/nbt.js';
import { normalizeNbtItem, normalizeSkycryptItem } from '../items/extract.js';
import { classifyItem } from '../items/classify.js';
import { makeCtx, toFinding } from './context.js';

// Recursively find inventory blobs shaped { type, data:"<base64>" }, tagging
// each with the nearest non-numeric ancestor key as its location.
function findInventoryBlobs(node, locHint = 'inventory', out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.data === 'string' && typeof node.type === 'number') {
    out.push({ location: locHint, data: node.data });
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') {
      findInventoryBlobs(v, /^\d+$/.test(k) ? locHint : k, out);
    }
  }
  return out;
}

// Gather + normalize items from Hypixel profiles (full inventories). Throws if
// no key or the API errors, so the caller can fall back to SkyCrypt.
async function gatherFromHypixel(uuid) {
  const profiles = await getProfiles(uuid);
  const items = [];
  let profilesScanned = 0;
  let lastSave = 0; // most-recent login across this player's profiles (ms epoch)
  for (const p of profiles) {
    const member = p.members && p.members[uuid];
    if (!member) continue;
    profilesScanned++;
    if (typeof member.last_save === 'number') lastSave = Math.max(lastSave, member.last_save);
    // findInventoryBlobs recurses the whole member object, so it already covers
    // EVERY container: main inventory, ender chest, backpacks, personal vault,
    // wardrobe, equipment, and accessory/other bags — not just equipped gear.
    for (const blob of findInventoryBlobs(member.inventory || member)) {
      let raws;
      try { raws = await decodeInventory(blob.data); } catch { continue; }
      for (const raw of raws) {
        const it = normalizeNbtItem(raw, blob.location);
        if (!it) continue;
        it.profile_id = p.profile_id;
        it.profile_name = p.cute_name;
        items.push(it);
      }
    }
  }
  return { items, profilesScanned, lastSave };
}

// Gather + normalize items from the keyless SkyCrypt API (fewer items).
async function gatherFromSkycrypt(handle) {
  const profile = await getProfile(handle);
  const profilesScanned = profile && profile.profiles ? Object.keys(profile.profiles).length : 0;
  const items = [];
  for (const raw of collectItemsFromProfile(profile)) {
    const it = normalizeSkycryptItem(raw);
    if (it) items.push(it);
  }
  return { items, profilesScanned };
}

// Scan one player's profiles, classify items, store findings. Uses the Hypixel
// key path when available (richest), automatically falling back to SkyCrypt on
// any failure (or when no key is set). With a key it also returns the player's
// friend UUIDs so the crawler can chain the social graph.
//   opts.withFriends — fetch friends (key only); default true.
export async function scanProfile(input, { source = 'manual', withFriends = true } = {}) {
  const { uuid, username } = await resolvePlayer(input);
  const ctx = makeCtx();

  let items = [];
  let profilesScanned = 0;
  let lastSave = 0;
  let mode;
  let warning = null;

  if (config.hypixelApiKey) {
    try {
      ({ items, profilesScanned, lastSave } = await gatherFromHypixel(uuid));
      mode = 'hypixel';
    } catch (err) {
      // Key present but failed (bad key, throttled, private) — degrade.
      warning = `hypixel failed (${err.message}); used skycrypt`;
      ({ items, profilesScanned } = await gatherFromSkycrypt(username || uuid));
      mode = 'skycrypt-fallback';
    }
  } else {
    ({ items, profilesScanned } = await gatherFromSkycrypt(username || uuid));
    mode = 'skycrypt';
  }

  // Inactivity signal: how long since this player last logged in. Dormant
  // accounts (often quit/banned) are exactly where forgotten exotics sit.
  const inactiveDays = lastSave ? Math.floor((Date.now() - lastSave) / 86_400_000) : null;
  const dormant = inactiveDays != null && inactiveDays >= config.crawler.dormantDays;

  // Pass 1: classify against pre-scan learned defaults.
  const findings = [];
  for (const it of items) {
    for (const fr of classifyItem(it, ctx)) {
      findings.push(toFinding(fr, it, { uuid, username, source }));
    }
  }
  // Pass 2: learn default colours from undyed leather pieces.
  for (const it of items) {
    if (it.hex && !(it.extra && it.extra.dye_item)) ctx.recordPieceColor(it.itemId, it.hex);
  }

  repo.upsertAccount({
    uuid, username, source, profileCount: profilesScanned,
    note: dormant ? `dormant ${inactiveDays}d` : (inactiveDays != null ? `active ${inactiveDays}d ago` : null),
  });
  let newFindings = 0;
  for (const f of findings) if (repo.insertFinding(f).isNew) newFindings++;

  // Friend graph (key only). Failures here never fail the scan.
  let friends = [];
  if (withFriends && config.hypixelApiKey) {
    try { friends = await getFriendUuids(uuid); } catch { /* ignore */ }
  }

  return {
    uuid, username, mode, warning,
    profilesScanned, itemsScanned: items.length,
    inactiveDays, dormant,
    findings, newFindings, friends,
  };
}
