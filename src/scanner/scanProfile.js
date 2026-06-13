import { config } from '../config.js';
import { repo } from '../db/index.js';
import { resolvePlayer } from '../clients/mojang.js';
import { getProfiles, getFriendUuids } from '../clients/hypixel.js';
import { getProfile, collectItemsFromProfile } from '../clients/skycrypt.js';
import { decodeInventory } from '../items/nbt.js';
import { normalizeNbtItem, normalizeSkycryptItem } from '../items/extract.js';
import { classifyItem } from '../items/classify.js';
import { budgetStatus } from './budget.js';
import { isRandomDyed, isAnimated, isTieredColor } from '../items/data.js';
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
async function gatherFromHypixel(uuid, keyIndex = null) {
  const profiles = await getProfiles(uuid, keyIndex);
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
export async function scanProfile(input, { source = 'manual', withFriends = true, keyIndex = null } = {}) {
  const { uuid, username } = await resolvePlayer(input);
  const ctx = makeCtx();

  let items = [];
  let profilesScanned = 0;
  let lastSave = 0;
  let mode;
  let warning = null;
  let friends = [];

  if (config.hypixelApiKey) {
    // Fire profiles + friends concurrently — independent keyed calls, paced per
    // key by the limiter, so overlapping them halves the per-account latency.
    // Budget-saver: the friends call DOUBLES the request cost per account. When
    // the daily allowance is running tight (paced remaining low), skip friends
    // and spend the budget on profiles (the actual item source) instead.
    const b = budgetStatus();
    const friendsAffordable = !config.budget.enabled || b.pacedRemaining > config.budget.friendsMinRemaining;
    const wantFriends = withFriends && friendsAffordable;
    const [profRes, friendRes] = await Promise.allSettled([
      gatherFromHypixel(uuid, keyIndex),
      wantFriends ? getFriendUuids(uuid, keyIndex) : Promise.resolve([]),
    ]);
    if (profRes.status === 'fulfilled') {
      ({ items, profilesScanned, lastSave } = profRes.value);
      mode = 'hypixel';
    } else {
      // Key path failed (bad key, throttled, private). Try SkyCrypt, but NEVER
      // let a fallback failure hard-error the whole scan — record it and move on
      // with whatever we have (usually nothing) so the crawler keeps going.
      warning = `hypixel failed (${profRes.reason.message})`;
      try {
        ({ items, profilesScanned } = await gatherFromSkycrypt(username || uuid));
        mode = 'skycrypt-fallback';
      } catch (e2) {
        warning += `; skycrypt failed (${e2.message})`;
        mode = 'failed';
      }
    }
    if (friendRes.status === 'fulfilled') friends = friendRes.value || [];
  } else {
    try {
      ({ items, profilesScanned } = await gatherFromSkycrypt(username || uuid));
      mode = 'skycrypt';
    } catch (e) {
      warning = `skycrypt failed (${e.message})`;
      mode = 'failed';
    }
  }

  // Inactivity signal: how long since this player last logged in. Dormant
  // accounts (often quit/banned) are exactly where forgotten exotics sit.
  const inactiveDays = lastSave ? Math.floor((Date.now() - lastSave) / 86_400_000) : null;
  const dormant = inactiveDays != null && inactiveDays >= config.crawler.dormantDays;

  // Pass 1: classify against pre-scan learned defaults. Skip dropped fragments
  // (random-dyed sets like Satin/Oxford — they aren't real exotics).
  const findings = [];
  for (const it of items) {
    for (const fr of classifyItem(it, ctx)) {
      if (fr.drop && config.dropRandomDyed) continue;
      findings.push(toFinding(fr, it, { uuid, username, source }));
    }
  }
  // Pass 2: learn default colours from undyed leather pieces — but NEVER from
  // random-dyed sets, whose colours are meaningless and would poison defaults.
  for (const it of items) {
    if (it.hex && !(it.extra && it.extra.dye_item)
        && !isRandomDyed(it.itemId) && !isAnimated(it.itemId, it.hex)
        && !isTieredColor(it.itemId)) {
      ctx.recordPieceColor(it.itemId, it.hex);
    }
  }

  repo.upsertAccount({
    uuid, username, source, profileCount: profilesScanned,
    note: dormant ? `dormant ${inactiveDays}d` : (inactiveDays != null ? `active ${inactiveDays}d ago` : null),
  });
  let newFindings = 0;
  for (const f of findings) if (repo.insertFinding(f).isNew) newFindings++;
  // (friends were fetched concurrently with the profile above)

  return {
    uuid, username, mode, warning,
    profilesScanned, itemsScanned: items.length,
    inactiveDays, dormant,
    findings, newFindings, friends,
  };
}
