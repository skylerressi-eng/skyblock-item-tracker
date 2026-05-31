import { Router } from 'express';
import { repo } from '../db/index.js';

export const findingsRouter = Router();

// GET /api/findings?category=&subcategory=&confidence=&source=&q=&username=&limit=&offset=
findingsRouter.get('/', (req, res) => {
  const { category, subcategory, confidence, source, q, username, limit, offset } = req.query;
  const rows = repo.queryFindings({
    category, subcategory, confidence, source, q, username, limit, offset,
  });
  res.json({ ok: true, count: rows.length, findings: rows });
});
