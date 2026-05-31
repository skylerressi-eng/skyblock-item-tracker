import zlib from 'node:zlib';
import { promisify } from 'node:util';
import nbt from 'prismarine-nbt';

const gunzip = promisify(zlib.gunzip);

// Hypixel stores inventories / auction items as base64( gzip( NBT ) ). The
// decoded NBT is a compound { i: [ <item>, ... ] }. prismarine-nbt auto-detects
// gzip, but we fall back to a manual gunzip just in case.
export async function decodeInventory(base64) {
  if (!base64) return [];
  const buf = Buffer.from(base64, 'base64');
  let parsed;
  try {
    ({ parsed } = await nbt.parse(buf));
  } catch {
    const raw = await gunzip(buf);
    ({ parsed } = await nbt.parse(raw));
  }
  const simple = nbt.simplify(parsed);
  const list = simple && simple.i;
  if (!Array.isArray(list)) return [];
  // Empty slots come back as {} (the SkyBlock convention) or occasionally as an
  // air stub like { id: 0, Count: 0 } — drop both.
  return list.filter(
    (it) => it && Object.keys(it).length > 0 && (it.Count == null || it.Count > 0),
  );
}

// Auction item_bytes contain a single item wrapped in the same { i: [ item ] }.
export async function decodeSingleItem(base64) {
  const items = await decodeInventory(base64);
  return items[0] || null;
}
