import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { getDb, repo } from './db/index.js';
import { RANDOM_DYED_PATTERNS } from './items/data.js';
import { scanRouter } from './routes/scan.js';
import { findingsRouter } from './routes/findings.js';
import { pricesRouter } from './routes/prices.js';
import { statsRouter } from './routes/stats.js';
import { crawlRouter } from './routes/crawl.js';
import { referenceRouter } from './routes/reference.js';
import { startAhWorker } from './scanner/ahWorker.js';
import { startCrawler } from './scanner/crawler.js';

getDb(); // initialize schema before serving

// One-time cleanup: purge any findings/learned-colours for random-dyed sets
// (Satin/Oxford/Velvet/Cashmere) that were stored before they were excluded.
if (config.dropRandomDyed) {
  const purged = repo.purgeItemPatterns(RANDOM_DYED_PATTERNS);
  if (purged.findings || purged.colors) {
    console.log(`[cleanup] purged ${purged.findings} random-dyed finding(s) and ${purged.colors} poisoned colour default(s)`);
  }
}

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/scan', scanRouter);
app.use('/api/findings', findingsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/crawl', crawlRouter);
app.use('/api/reference', referenceRouter);

app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(config.port, () => {
  console.log(`skyblock-item-tracker listening on http://localhost:${config.port}`);
  if (config.hypixelApiKey) {
    console.log('[info] Hypixel API key detected — full inventory scans + friend-chain crawl enabled.');
  } else {
    console.log('[info] No HYPIXEL_API_KEY — using SkyCrypt fallback (fewer items) + AH-seller crawl.');
  }
  // Background engines: AH worker discovers items/sellers; crawler drains the
  // account frontier. Both write findings the live dashboard streams in.
  startAhWorker();
  startCrawler();
});
