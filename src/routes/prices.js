import { Router } from 'express';
import { currentPrice, priceHistory } from '../clients/coflnet.js';

export const pricesRouter = Router();

// GET /api/prices/:item?span=day — current price + history from Coflnet.
pricesRouter.get('/:item', async (req, res) => {
  const item = req.params.item;
  const span = String(req.query.span || 'day');
  const out = { ok: true, item: item.toUpperCase(), span };
  const [cur, hist] = await Promise.allSettled([currentPrice(item), priceHistory(item, span)]);
  if (cur.status === 'fulfilled') out.current = cur.value;
  else out.currentError = cur.reason.message;
  if (hist.status === 'fulfilled') out.history = hist.value;
  else out.historyError = hist.reason.message;
  res.json(out);
});
