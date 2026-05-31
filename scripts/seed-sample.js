// Insert clearly-labelled SAMPLE findings so the UI has something to show
// offline (e.g. when the data APIs are blocked by a network policy).
// Run with: npm run seed
import { repo } from '../src/db/index.js';

const sampleFindings = [
  {
    item_uuid: 'sample-1', item_id: 'CRYSTAL_HELMET', item_name: 'Pure Black Crystal Helmet',
    rarity: 'LEGENDARY', category: 'exotic', subcategory: 'PURE', hex: '000000',
    confidence: 'high', reason: 'Matches a known PURE exotic colour',
    account_uuid: 'sample', username: 'ExoticCollector', location: 'inventory', source: 'sample',
  },
  {
    item_uuid: 'sample-2', item_id: 'FAIRY_CHESTPLATE', item_name: 'Off-colour Fairy Chestplate',
    rarity: 'EPIC', category: 'exotic', subcategory: 'EXOTIC', hex: 'ff8fd4',
    confidence: 'high', reason: "Off-default colour (this piece's default is #ff63b6)",
    account_uuid: 'sample', username: 'PinkFairy', location: 'wardrobe_contents', source: 'sample',
  },
  {
    item_uuid: 'sample-3', item_id: 'CRYSTAL_LEGGINGS', item_name: 'Aqua Crystal Leggings',
    rarity: 'LEGENDARY', category: 'exotic', subcategory: 'EXOTIC', hex: '7fffd4',
    confidence: 'low', reason: 'Default colour not yet learned for this piece — scan more copies to confirm',
    account_uuid: 'sample', username: 'AquaMan', location: 'ender_chest_contents', source: 'sample',
  },
  {
    item_uuid: 'sample-4', item_id: 'POTATO_TALISMAN', item_name: 'Potato Talisman',
    rarity: 'SPECIAL', category: 'special_rarity', subcategory: 'SPECIAL', hex: null,
    confidence: 'high', reason: 'SPECIAL rarity item',
    account_uuid: 'sample', username: 'SpudLord', location: 'talisman_bag', source: 'sample', price: 2000000,
  },
  {
    item_uuid: 'sample-5', item_id: 'CAKE_SOUL', item_name: 'Cake Soul',
    rarity: 'SPECIAL', category: 'curated_rare', subcategory: 'COLLECTOR', hex: null,
    confidence: 'high', reason: 'Extremely rare collectible',
    account_uuid: 'sample', username: 'OldTimer', location: 'inventory', source: 'sample', price: 900000000,
  },
];

repo.upsertAccount({ uuid: 'sample', username: 'sample-data', source: 'sample', profileCount: 1 });

// Give one piece a learned default so low/high confidence both appear realistically.
for (let i = 0; i < 8; i++) repo.recordPieceColor('CRYSTAL_HELMET', '22d3ee');

let n = 0;
for (const f of sampleFindings) if (repo.insertFinding(f).isNew) n++;

console.log(`Seeded ${n} new sample findings (source="sample"). Start the server and open the site to see them.`);
console.log('Tip: filter the "source" dropdown to "sample data", or just browse all findings.');
