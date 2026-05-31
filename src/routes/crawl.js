import { Router } from 'express';
import { repo } from '../db/index.js';
import { getCrawlerStatus, seedQueue } from '../scanner/crawler.js';

export const crawlRouter = Router();

// GET /api/crawl — crawler + queue status (used by the live dashboard).
crawlRouter.get('/', (req, res) => {
  res.json({ ok: true, ...getCrawlerStatus() });
});

// POST /api/crawl/enqueue { username? , uuid? } — add an account to the frontier.
crawlRouter.post('/enqueue', (req, res) => {
  const { username, uuid } = req.body || {};
  if (!username && !uuid) {
    return res.status(400).json({ ok: false, error: 'username or uuid required' });
  }
  const r = repo.enqueue({
    username: username || null,
    uuid: uuid || null,
    source: 'manual',
    priority: 10,
  });
  res.json({ ok: true, added: r.added, key: r.key });
});

// POST /api/crawl/seed — (re)load seeds.json into the queue.
crawlRouter.post('/seed', (req, res) => {
  const n = seedQueue();
  res.json({ ok: true, seeded: n });
});
