import { config } from '../config.js';
import { repo } from '../db/index.js';
import { resolvePlayer } from '../clients/mojang.js';
import { getProfiles } from '../clients/hypixel.js';
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

// Scan one player's profiles, classify their items, and store findings.
export async function scanProfile(input, { source = 'manual' } = {}) {
  const { uuid, username } = await resolvePlayer(input);
  const ctx = makeCtx();

  const items = [];
  let profilesScanned = 0;
  let mode;

  if (config.hypixelApiKey) {
    mode = 'hypixel';
    const profiles = await getProfiles(uuid);
    for (const p of profiles) {
      const member = p.members && p.members[uuid];
      if (!member) continue;
      profilesScanned++;
      const blobs = findInventoryBlobs(member.inventory || member);
      for (const blob of blobs) {
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
  } else {
    mode = 'skycrypt';
    const profile = await getProfile(username || uuid);
    profilesScanned = profile && profile.profiles ? Object.keys(profile.profiles).length : 0;
    for (const raw of collectItemsFromProfile(profile)) {
      const it = normalizeSkycryptItem(raw);
      if (it) items.push(it);
    }
  }

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

  repo.upsertAccount({ uuid, username, source, profileCount: profilesScanned });
  let newFindings = 0;
  for (const f of findings) if (repo.insertFinding(f).isNew) newFindings++;

  return { uuid, username, mode, profilesScanned, itemsScanned: items.length, findings, newFindings };
}
