import { Router } from 'express';
import { repo } from '../db/index.js';
import { currentPrice, priceHistory } from '../clients/coflnet.js';

export const findingsRouter = Router();

// GET /api/findings?category=&subcategory=&confidence=&source=&q=&username=&since=
//   &color=<hex>&item=<id/name>&state=enchanted|clean|reforged&sort=&limit=&offset=
// `since` (epoch ms) returns only findings newer than that — used by the live
// dashboard to stream in new discoveries without reloading everything.
findingsRouter.get('/', (req, res) => {
  const {
    category, subcategory, confidence, source, q, username, since,
    color, item, state, excludeCategory, sort, limit, offset,
  } = req.query;
  const rows = repo.queryFindings({
    category, subcategory, confidence, source, q, username, since,
    color, item, state, excludeCategory, sort, limit, offset,
  });
  res.json({ ok: true, count: rows.length, latest: repo.latestFindingTs(), findings: rows });
});

// GET /api/findings/by-hex/:hex — every finding sharing a colour + population stats.
findingsRouter.get('/by-hex/:hex', (req, res) => {
  const stats = repo.hexStats(req.params.hex);
  if (!stats) return res.status(400).json({ ok: false, error: 'invalid hex' });
  const findings = repo.findingsByHex(req.params.hex);
  res.json({ ok: true, ...stats, findings });
});

// GET /api/findings/:id — the detail view for one clicked item. Bundles:
//   - the finding itself (owner, location, colour, reason)
//   - the NON-DYED base item's price + AH/Bazaar history (dye doesn't change the
//     item id, so item_id is the base item)
//   - colour population: how many of THIS hex have been found (across all items)
findingsRouter.get('/:id', async (req, res) => {
  const f = repo.getFinding(req.params.id);
  if (!f) return res.status(404).json({ ok: false, error: 'finding not found' });

  const out = { ok: true, finding: f };

  // Colour population (only meaningful for coloured/exotic finds).
  if (f.hex) out.colorStats = repo.hexStats(f.hex);

  // Base (non-dyed) item price + history from Coflnet, by item_id.
  if (f.item_id) {
    const span = String(req.query.span || 'week');
    out.basePrice = { item: f.item_id, span };
    const [cur, hist] = await Promise.allSettled([
      currentPrice(f.item_id),
      priceHistory(f.item_id, span),
    ]);
    if (cur.status === 'fulfilled') out.basePrice.current = cur.value;
    else out.basePrice.currentError = cur.reason.message;
    if (hist.status === 'fulfilled') out.basePrice.history = hist.value;
    else out.basePrice.historyError = hist.reason.message;
  }

  res.json(out);
});
