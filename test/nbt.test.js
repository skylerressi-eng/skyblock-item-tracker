import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import nbt from 'prismarine-nbt';

import { decodeInventory, decodeSingleItem } from '../src/items/nbt.js';
import { normalizeNbtItem } from '../src/items/extract.js';

// Build the same base64( gzip( NBT ) ) envelope Hypixel uses for inventories.
function makeInventoryBytes() {
  const root = {
    type: 'compound',
    name: '',
    value: {
      i: {
        type: 'list',
        value: {
          type: 'compound',
          value: [
            {
              id: { type: 'short', value: 299 },
              Count: { type: 'byte', value: 1 },
              Damage: { type: 'short', value: 0 },
              tag: {
                type: 'compound',
                value: {
                  display: {
                    type: 'compound',
                    value: {
                      Name: { type: 'string', value: '§dExotic Chestplate' },
                      color: { type: 'int', value: 0x00ff99 },
                      Lore: { type: 'list', value: { type: 'string', value: ['§5§lEPIC CHESTPLATE'] } },
                    },
                  },
                  ExtraAttributes: {
                    type: 'compound',
                    value: {
                      id: { type: 'string', value: 'CRYSTAL_CHESTPLATE' },
                      uuid: { type: 'string', value: 'abc-123' },
                    },
                  },
                },
              },
            },
            {}, // empty slot
          ],
        },
      },
    },
  };
  return zlib.gzipSync(nbt.writeUncompressed(root, 'big')).toString('base64');
}

test('nbt: decode + normalize an inventory item end-to-end', async () => {
  const b64 = makeInventoryBytes();
  const items = await decodeInventory(b64);
  assert.equal(items.length, 1, 'empty slot should be dropped');

  const it = normalizeNbtItem(items[0], 'inv_contents');
  assert.equal(it.itemId, 'CRYSTAL_CHESTPLATE');
  assert.equal(it.hex, '00ff99');
  assert.equal(it.rarity, 'EPIC');
  assert.equal(it.uuid, 'abc-123');
  assert.equal(it.location, 'inv_contents');
});

test('nbt: decodeSingleItem returns the first item', async () => {
  const it = await decodeSingleItem(makeInventoryBytes());
  assert.ok(it);
  assert.equal(it.tag.ExtraAttributes.id, 'CRYSTAL_CHESTPLATE');
});

test('nbt: empty input yields no items', async () => {
  assert.deepEqual(await decodeInventory(''), []);
});

test('nbt: air-stub slots ({id:0, Count:0}) are dropped', async () => {
  const root = {
    type: 'compound',
    name: '',
    value: {
      i: {
        type: 'list',
        value: {
          type: 'compound',
          value: [
            { id: { type: 'short', value: 0 }, Count: { type: 'byte', value: 0 }, Damage: { type: 'short', value: 0 } },
            {
              id: { type: 'short', value: 280 },
              Count: { type: 'byte', value: 1 },
              tag: { type: 'compound', value: { ExtraAttributes: { type: 'compound', value: { id: { type: 'string', value: 'STICK' } } } } },
            },
          ],
        },
      },
    },
  };
  const b64 = zlib.gzipSync(nbt.writeUncompressed(root, 'big')).toString('base64');
  const items = await decodeInventory(b64);
  assert.equal(items.length, 1, 'air stub with Count 0 should be dropped');
  assert.equal(items[0].tag.ExtraAttributes.id, 'STICK');
});
