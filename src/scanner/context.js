import { config } from '../config.js';
import { repo } from '../db/index.js';
import { buildCuratedIndex } from '../items/data.js';

const curatedIndex = buildCuratedIndex();

// Classification context shared by the profile scanner and the AH worker.
export function makeCtx() {
  return {
    getDefaultHex: (id) => repo.getDefaultHex(id),
    rareTiers: config.rareTiers,
    curatedIndex,
    recordPieceColor: (id, hex) => repo.recordPieceColor(id, hex),
  };
}

// Merge a classifier fragment + normalized item + scan context into a DB row.
export function toFinding(fr, it, base = {}) {
  return {
    item_uuid: it.uuid || null,
    item_id: it.itemId || null,
    item_name: it.name || null,
    rarity: it.rarity || null,
    category: fr.category,
    subcategory: fr.subcategory || null,
    hex: fr.hex || it.hex || null,
    confidence: fr.confidence || null,
    reason: fr.reason || null,
    account_uuid: base.uuid || null,
    username: base.username || null,
    profile_id: it.profile_id || base.profile_id || null,
    profile_name: it.profile_name || null,
    location: it.location || null,
    source: base.source || null,
    price: base.price ?? null,
    extra: fr.label ? { label: fr.label } : undefined,
  };
}
