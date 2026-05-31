import { Router } from 'express';
import { repo } from '../db/index.js';

export const findingsRouter = Router();

// GET /api/findings?category=&subcategory=&confidence=&source=&q=&username=&since=&limit=&offset=
// `since` (epoch ms) returns only findings newer than that — used by the live
// dashboard to stream in new discoveries without reloading everything.
findingsRouter.get('/', (req, res) => {
  const { category, subcategory, confidence, source, q, username, since, limit, offset } = req.query;
  const rows = repo.queryFindings({
    category, subcategory, confidence, source, q, username, since, limit, offset,
  });
  res.json({ ok: true, count: rows.length, latest: repo.latestFindingTs(), findings: rows });
});
