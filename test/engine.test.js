import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hexFromInt, normHex, dist } from '../src/items/colors.js';
import { classifyFamily, classifyExotic } from '../src/items/exotics.js';
import { classifyRarity, classifyCurated } from '../src/items/rarity.js';
import { classifyItem } from '../src/items/classify.js';
import { parseRarityFromLore, normalizeNbtItem } from '../src/items/extract.js';
import { buildCuratedIndex } from '../src/items/data.js';

const RARE_TIERS = ['MYTHIC', 'DIVINE', 'SPECIAL', 'VERY_SPECIAL'];
const curatedIndex = buildCuratedIndex();
const ctx = (defaults = {}) => ({
  getDefaultHex: (id) => defaults[id] || null,
  rareTiers: RARE_TIERS,
  curatedIndex,
});

test('colors: hex/int conversions and distance', () => {
  assert.equal(hexFromInt(0x00ff99), '00ff99');
  assert.equal(hexFromInt(0), '000000');
  assert.equal(normHex('#ABCDEF'), 'abcdef');
  assert.equal(normHex('fff'), 'ffffff');
  assert.equal(normHex(16777215), 'ffffff');
  assert.equal(dist('000000', '000000'), 0);
  assert.ok(dist('000000', 'ffffff') > 440);
});

test('exotics: pure colours land in the PURE family exactly', () => {
  assert.deepEqual(classifyFamily('000000'), { name: 'PURE', exact: true });
  assert.deepEqual(classifyFamily('ff00ff'), { name: 'PURE', exact: true });
  assert.equal(classifyFamily('123456').name, 'EXOTIC');
});

test('exotics: pure black armour with no dye is a high-confidence exotic', () => {
  const item = { itemId: 'CRYSTAL_HELMET', hex: '000000', extra: {} };
  const f = classifyExotic(item, ctx());
  assert.equal(f.category, 'exotic');
  assert.equal(f.subcategory, 'PURE');
  assert.equal(f.confidence, 'high');
});

test('exotics: off-default colour is flagged high when default is known', () => {
  const item = { itemId: 'CRYSTAL_HELMET', hex: '123456', extra: {} };
  const f = classifyExotic(item, ctx({ CRYSTAL_HELMET: '22d3ee' }));
  assert.equal(f.confidence, 'high');
  assert.match(f.reason, /default/i);
});

test('exotics: matching the learned default is NOT exotic', () => {
  const item = { itemId: 'CRYSTAL_HELMET', hex: '22d3ee', extra: {} };
  assert.equal(classifyExotic(item, ctx({ CRYSTAL_HELMET: '22d3ee' })), null);
});

test('exotics: a legitimately dyed item is NOT exotic', () => {
  const item = { itemId: 'CRYSTAL_HELMET', hex: '123456', extra: { dye_item: 'DYE_PURE_BLACK' } };
  assert.equal(classifyExotic(item, ctx()), null);
});

test('exotics: undyed vanilla leather is NOT exotic; unknown default is low-confidence', () => {
  assert.equal(classifyExotic({ itemId: 'X', hex: 'a06540', extra: {} }, ctx()), null);
  const f = classifyExotic({ itemId: 'X', hex: '654321', extra: {} }, ctx());
  assert.equal(f.confidence, 'low');
});

test('exotics: items without a colour are skipped', () => {
  assert.equal(classifyExotic({ itemId: 'HYPERION', hex: null }, ctx()), null);
});

test('rarity: configured tiers flag, common LEGENDARY does not', () => {
  assert.equal(classifyRarity({ rarity: 'SPECIAL' }, { rareTiers: RARE_TIERS }).category, 'special_rarity');
  assert.equal(classifyRarity({ rarity: 'LEGENDARY' }, { rareTiers: RARE_TIERS }), null);
});

test('curated: known collector item is flagged', () => {
  const f = classifyCurated({ itemId: 'CAKE_SOUL' }, curatedIndex);
  assert.equal(f.category, 'curated_rare');
  assert.equal(classifyCurated({ itemId: 'DIRT' }, curatedIndex), null);
});

test('classify: one item can produce multiple findings', () => {
  const item = { itemId: 'CRYSTAL_HELMET', hex: '000000', rarity: 'SPECIAL', extra: {} };
  const findings = classifyItem(item, ctx());
  const cats = findings.map((f) => f.category).sort();
  assert.deepEqual(cats, ['exotic', 'special_rarity']);
});

test('extract: rarity parsing handles VERY SPECIAL vs SPECIAL', () => {
  assert.equal(parseRarityFromLore(['§7x', '§c§lVERY SPECIAL']), 'VERY_SPECIAL');
  assert.equal(parseRarityFromLore(['§7x', '§c§lSPECIAL']), 'SPECIAL');
  assert.equal(parseRarityFromLore(['§7x', '§6§lLEGENDARY SWORD']), 'LEGENDARY');
});

test('extract: normalizeNbtItem reads colour, id, rarity, uuid', () => {
  const raw = {
    id: 299,
    Count: 1,
    tag: {
      display: { Name: '§dExotic Chest', color: 0x123456, Lore: ['§7x', '§5§lEPIC CHESTPLATE'] },
      ExtraAttributes: { id: 'CRYSTAL_CHESTPLATE', uuid: 'u-1' },
    },
  };
  const it = normalizeNbtItem(raw, 'inventory');
  assert.equal(it.itemId, 'CRYSTAL_CHESTPLATE');
  assert.equal(it.hex, '123456');
  assert.equal(it.rarity, 'EPIC');
  assert.equal(it.uuid, 'u-1');
  assert.equal(it.name, 'Exotic Chest');
});
