import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hexFromInt, normHex, dist, colorName, normColorName } from '../src/items/colors.js';
import { classifyFamily, classifyExotic, matchKnownDye } from '../src/items/exotics.js';
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

test('colors: general colour naming buckets hues correctly', () => {
  assert.equal(colorName('ff0000'), 'red');
  assert.equal(colorName('2a6cff'), 'blue');
  assert.equal(colorName('9b30ff'), 'purple');
  assert.equal(colorName('22c032'), 'green');
  assert.equal(colorName('ff9000'), 'orange');
  assert.equal(colorName('000000'), 'black');
  assert.equal(colorName('f5f5f5'), 'white');
  assert.equal(colorName('8a8a8a'), 'gray');
  // aliases normalise
  assert.equal(normColorName('grey'), 'gray');
  assert.equal(normColorName('violet'), 'purple');
});

test('exotics: pure colours land in the PURE family exactly', () => {
  assert.deepEqual(classifyFamily('000000'), { name: 'PURE', exact: true });
  assert.deepEqual(classifyFamily('ff00ff'), { name: 'PURE', exact: true });
  // an off-chart colour defaults to the OG_DYED tag (the classic exotic origin)
  assert.equal(classifyFamily('123456').name, 'OG_DYED');
});

test('exotics: pure black armour with no dye is a high-confidence exotic', () => {
  const item = { itemId: 'CRYSTAL_HELMET', hex: '000000', extra: {} };
  const f = classifyExotic(item, ctx());
  assert.equal(f.category, 'exotic');
  assert.equal(f.subcategory, 'PURE');
  assert.equal(f.confidence, 'high');
});

test('exotics: off-default colour is flagged high when LEARNED default is known', () => {
  const item = { itemId: 'SOME_HELMET', hex: '123456', extra: {} };
  const f = classifyExotic(item, ctx({ SOME_HELMET: '22d3ee' }));
  assert.equal(f.confidence, 'high');
  assert.match(f.reason, /default/i);
});

test('exotics: matching the learned default is NOT exotic', () => {
  const item = { itemId: 'SOME_HELMET', hex: '22d3ee', extra: {} };
  assert.equal(classifyExotic(item, ctx({ SOME_HELMET: '22d3ee' })), null);
});

test('exotics: a modern dye_item piece is NOT exotic', () => {
  const item = { itemId: 'SOME_HELMET', hex: '123456', extra: { dye_item: 'DYE_PURE_BLACK' } };
  assert.equal(classifyExotic(item, ctx()), null);
});

test('exotics: undyed vanilla leather is NOT exotic; unknown default is medium-confidence', () => {
  assert.equal(classifyExotic({ itemId: 'X', hex: 'a06540', extra: {} }, ctx()), null);
  const f = classifyExotic({ itemId: 'X', hex: '654321', extra: {} }, ctx());
  assert.equal(f.confidence, 'medium');
});

test('exotics: Crystal and Fairy dye colours are NOT exotic', () => {
  // Crystal chart entry
  assert.equal(matchKnownDye('1f0030').name, 'CRYSTAL');
  assert.equal(classifyExotic({ itemId: 'X', hex: '1f0030', extra: {} }, ctx()), null);
  // Fairy chart entry
  assert.equal(matchKnownDye('ff00ff') ? 'known' : null, 'known');
  // a Fairy-only purple that is NOT a pure colour
  assert.equal(classifyExotic({ itemId: 'X', hex: 'b266ff', extra: {} }, ctx()), null);
});

test('exotics: a true off-chart colour IS exotic even if it is a colourful armour', () => {
  // #654321 is not vanilla, not Crystal/Fairy, not a piece default -> exotic
  const f = classifyExotic({ itemId: 'GENERIC_LEATHER_HELMET', hex: '654321', extra: {} }, ctx());
  assert.equal(f.category, 'exotic');
});

test('exotics: preloaded Magma default colour is NOT exotic', () => {
  // ff9300 is Magma's factory colour, preloaded in default-colors.json
  assert.equal(classifyExotic({ itemId: 'ARMOR_OF_MAGMA_CHESTPLATE', hex: 'ff9300', extra: {} }, ctx()), null);
  // but an off-colour Magma piece is exotic
  const f = classifyExotic({ itemId: 'ARMOR_OF_MAGMA_CHESTPLATE', hex: '101010', extra: {} }, ctx());
  assert.equal(f.category, 'exotic');
});

test('exotics: pure black on any leather item is a PURE exotic (works on ALL items)', () => {
  const f = classifyExotic({ itemId: 'WHATEVER_BOOTS', hex: '000000', extra: {} }, ctx());
  assert.equal(f.subcategory, 'PURE');
  assert.equal(f.confidence, 'high');
});

test('exotics: items without a colour are skipped', () => {
  assert.equal(classifyExotic({ itemId: 'HYPERION', hex: null }, ctx()), null);
});

test('satin: a Satin piece with an off-default colour is random_dyed, NOT exotic', () => {
  const f = classifyExotic({ itemId: 'SATIN_TROUSERS', hex: '3b7a2c', extra: {} }, ctx());
  assert.equal(f.category, 'random_dyed');
  assert.equal(f.subcategory, 'RANDOM');
  assert.equal(f.confidence, 'low');
  assert.ok(f.priority < 10, 'random_dyed must rank far below real exotics');
});

test('tiered: Frozen Blaze / Crimson Isle colours are tiered_color, NOT exotic', () => {
  // The reported false positive: Frozen Blaze #f7da33 "learned default #a0daef".
  const fb = classifyExotic({ itemId: 'FROZEN_BLAZE_CHESTPLATE', hex: 'f7da33', extra: {} }, ctx({ FROZEN_BLAZE_CHESTPLATE: 'a0daef' }));
  assert.equal(fb.category, 'tiered_color');
  assert.equal(fb.drop, true);
  // Crimson Isle / Kuudra tier colours
  for (const id of ['CRIMSON_CHESTPLATE', 'TERROR_LEGGINGS', 'AURORA_BOOTS', 'HOLLOW_HELMET']) {
    assert.equal(classifyExotic({ itemId: id, hex: 'ff700a', extra: {} }, ctx()).category, 'tiered_color', id);
  }
});

test('tiered: a real OG-dyeable set is NOT caught by the tiered list', () => {
  // ARMOR_OF_MAGMA (OG-dyeable) must still flag; only MAGMA_LORD is tiered.
  assert.equal(classifyExotic({ itemId: 'ARMOR_OF_MAGMA_CHESTPLATE', hex: '272727', extra: {} }, ctx()).category, 'exotic');
  assert.equal(classifyExotic({ itemId: 'MAGMA_LORD_CHESTPLATE', hex: '272727', extra: {} }, ctx()).category, 'tiered_color');
});

test('price floor: a dirt-cheap unconfirmed exotic is dropped, a pricey one is kept', () => {
  const cheap = classifyExotic({ itemId: 'WISE_DRAGON_CHESTPLATE', hex: '654321', extra: {} }, { getDefaultHex: () => null, price: 37 });
  assert.equal(cheap.category, 'tiered_color');
  assert.equal(cheap.subcategory, 'CHEAP');
  assert.equal(cheap.drop, true);
  const pricey = classifyExotic({ itemId: 'WISE_DRAGON_CHESTPLATE', hex: '654321', extra: {} }, { getDefaultHex: () => null, price: 5000000 });
  assert.equal(pricey.category, 'exotic');
});

test('price floor: a CONFIRMED exotic (PURE) is kept even when cheap', () => {
  // #000000 is an exact PURE match -> high confidence -> price floor bypassed.
  const f = classifyExotic({ itemId: 'WISE_DRAGON_CHESTPLATE', hex: '000000', extra: {} }, { getDefaultHex: () => null, price: 37 });
  assert.equal(f.category, 'exotic');
  assert.equal(f.subcategory, 'PURE');
});

test('random-dyed: all four named cosmetic pieces are downranked + dropped', () => {
  // Velvet Top Hat, Cashmere Jacket, Satin Trousers, Oxford Shoes
  for (const id of ['VELVET_TOP_HAT', 'CASHMERE_JACKET', 'SATIN_TROUSERS', 'OXFORD_SHOES']) {
    const f = classifyExotic({ itemId: id, hex: '112233', extra: {} }, ctx());
    assert.equal(f.category, 'random_dyed', `${id} should be random_dyed`);
    assert.ok(f.priority < 10, `${id} must rank below real exotics`);
    assert.equal(f.drop, true, `${id} should be flagged drop (not stored)`);
  }
});

test('random-dyed: a learned default does NOT rescue an Oxford as exotic', () => {
  // Even with a (poisoned) learned default, an Oxford must stay random_dyed —
  // this is the exact bug from the screenshot.
  const f = classifyExotic({ itemId: 'OXFORD_SHOES', hex: '4a5a35', extra: {} }, ctx({ OXFORD_SHOES: '4ad497' }));
  assert.equal(f.category, 'random_dyed');
  assert.equal(f.drop, true);
});

test('priority: genuine exotics outrank random_dyed; PURE outranks unconfirmed', () => {
  const pure = classifyExotic({ itemId: 'X_HELMET', hex: '000000', extra: {} }, ctx());
  const og = classifyExotic({ itemId: 'Y_HELMET', hex: '654321', extra: {} }, ctx({ Y_HELMET: 'a06540' }));
  const satin = classifyExotic({ itemId: 'SATIN_TROUSERS', hex: '654321', extra: {} }, ctx());
  assert.ok(pure.priority > og.priority, 'exact PURE family ranks above off-default OG');
  assert.ok(og.priority > satin.priority, 'real OG exotic ranks above random-dyed satin');
});

test('animated: Great Spook is never exotic, on any frame (incl. #000000)', () => {
  // The famous false-positive cluster: every frame of the purple->black cycle.
  for (const hex of ['830093', '000000', '4c0055', '070008']) {
    const f = classifyExotic({ itemId: 'GREAT_SPOOK_CHESTPLATE', hex, extra: {} }, ctx());
    assert.equal(f.category, 'animated', `#${hex} on Great Spook must be animated`);
    assert.equal(f.drop, true);
  }
  // Greater Spook variant too.
  assert.equal(classifyExotic({ itemId: 'GREATER_SPOOK_HELMET', hex: '590065', extra: {} }, ctx()).category, 'animated');
});

test('animated: a known frame hex is excluded even on an unexpected id', () => {
  // #830093 is a published Spook frame; defensively treat it as animated.
  const f = classifyExotic({ itemId: 'SOME_LEATHER_HELMET', hex: '830093', extra: {} }, ctx());
  assert.equal(f.category, 'animated');
});

test('animated: a genuine exotic colour on a non-animated piece still flags', () => {
  // #830094 (one off a frame) on a normal piece is still a real exotic.
  const f = classifyExotic({ itemId: 'WISE_DRAGON_CHESTPLATE', hex: '830094', extra: {} }, ctx());
  assert.equal(f.category, 'exotic');
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
