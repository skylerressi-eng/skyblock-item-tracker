import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { getDb, repo } from './db/index.js';
import {
  RANDOM_DYED_PATTERNS, ANIMATED_PATTERNS, ANIMATED_DISTINCTIVE_FRAMES, TIERED_SET_PATTERNS,
  isRarityExcluded,
} from './items/data.js';
import { classifyExotic } from './items/exotics.js';
import { makeCtx } from './scanner/context.js';
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
//  - tiered/biome-coloured sets (Frozen Blaze, Crimson Isle/Kuudra, …)
//  - animated sets (Great/Greater Spook) by id AND by exact animation-frame hex
//    (catches frames mis-tagged PURE #000000 / OG_DYED #830093 on any id)
//  - dirt-cheap "exotics" (AH price under the floor) — baseline-colour fakes
if (config.dropRandomDyed) {
  const rd = repo.purgeItemPatterns(RANDOM_DYED_PATTERNS);
  const ti = repo.purgeItemPatterns(TIERED_SET_PATTERNS);
  const an = repo.purgeItemPatterns(ANIMATED_PATTERNS);
  const frames = repo.purgeFindingsByHex([...ANIMATED_DISTINCTIVE_FRAMES]);
  const cheap = repo.purgeCheapExotics(config.minExoticPrice);
  // Re-validate stored exotics against the CURRENT classifier so natural set
  // colours added to the baselines (Rancher's, Mushroom, Yog, …) are cleaned
  // retroactively, and remove rarity-excluded items (Kuudra Follower).
  const reclassified = repo.reclassifyExotics(classifyExotic, makeCtx);
  const rarity = repo.purgeRarityExcluded(isRarityExcluded);
  const findings = rd.findings + ti.findings + an.findings + frames + cheap + reclassified + rarity;
  const colors = rd.colors + ti.colors + an.colors;
  if (findings || colors) {
    console.log(`[cleanup] purged ${findings} false-positive finding(s) (random/tiered/animated/cheap/natural-colour/rarity) and ${colors} poisoned colour default(s)`);
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
  const nKeys = config.hypixelApiKeys.length;
  if (nKeys) {
    console.log(`[info] ${nKeys} Hypixel API key${nKeys > 1 ? 's' : ''} detected — full inventory scans + friend-chain crawl` +
      (nKeys > 1 ? ` (rotating, ${config.crawler.concurrency} parallel lanes).` : '.'));
  } else {
    console.log('[info] No HYPIXEL_API_KEY — using SkyCrypt fallback (fewer items) + AH-seller crawl.');
  }
  // Background engines: AH worker discovers items/sellers; crawler drains the
  // account frontier. Both write findings the live dashboard streams in.
  startAhWorker();
  startCrawler();
});
