import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { getDb, repo } from './db/index.js';
import { RANDOM_DYED_PATTERNS, ANIMATED_PATTERNS, ANIMATED_DISTINCTIVE_FRAMES } from './items/data.js';
import { scanRouter } from './routes/scan.js';
import { findingsRouter } from './routes/findings.js';
import { pricesRouter } from './routes/prices.js';
import { statsRouter } from './routes/stats.js';
import { crawlRouter } from './routes/crawl.js';
import { referenceRouter } from './routes/reference.js';
import { startAhWorker } from './scanner/ahWorker.js';
import { startCrawler } from './scanner/crawler.js';

getDb(); // initialize schema before serving

// One-time cleanup of pre-classified false positives:
//  - random-dyed sets (Satin/Oxford/Velvet/Cashmere)
//  - animated sets (Great/Greater Spook) by id AND by exact animation-frame hex
//    (catches frames mis-tagged PURE #000000 / OG_DYED #830093 on any id).
if (config.dropRandomDyed) {
  const rd = repo.purgeItemPatterns(RANDOM_DYED_PATTERNS);
  // Spook by id (covers ALL its frames incl. #000000 on Spook pieces), plus
  // distinctive (non-pure) frame hexes on any id. Pure #000000 on a NON-Spook
  // piece is left alone — that's a legitimate True-Black exotic.
  const an = repo.purgeItemPatterns(ANIMATED_PATTERNS);
  const frames = repo.purgeFindingsByHex([...ANIMATED_DISTINCTIVE_FRAMES]);
  const findings = rd.findings + an.findings + frames;
  const colors = rd.colors + an.colors;
  if (findings || colors) {
    console.log(`[cleanup] purged ${findings} false-positive finding(s) (random-dyed + animated) and ${colors} poisoned colour default(s)`);
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
