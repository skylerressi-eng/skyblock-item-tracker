import { Router } from 'express';
import {
  families, knownDyes, defaultColors, rareItemsRaw,
} from '../items/data.js';
import { config } from '../config.js';

export const referenceRouter = Router();

// GET /api/reference — everything the engine "knows" up front, for the UI's
// reference panel: which colours are/aren't exotic, and which items are rare.
referenceRouter.get('/', (req, res) => {
  const clean = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));

  res.json({
    ok: true,
    exotic: {
      info: families._familyInfo || {},
      families: clean(families),
    },
    notExotic: {
      vanillaLeather: defaultColors._vanillaLeather,
      knownDyes: clean(knownDyes),
      defaultColors: clean(defaultColors),
      note: 'Crystal & Fairy dyes, undyed leather, modern dye_item pieces, and a piece showing its factory default are all NOT exotic.',
    },
    rareItems: {
      curated: rareItemsRaw.items || [],
      gameBreakers: (rareItemsRaw.game_breakers || []).filter((i) => i.id !== 'EXAMPLE_ITEM_ID'),
      specialRarityTiers: config.rareTiers,
    },
  });
});
