import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { getDb } from './db/index.js';
import { scanRouter } from './routes/scan.js';
import { findingsRouter } from './routes/findings.js';
import { pricesRouter } from './routes/prices.js';
import { statsRouter } from './routes/stats.js';
import { startAhWorker } from './scanner/ahWorker.js';

getDb(); // initialize schema before serving

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/scan', scanRouter);
app.use('/api/findings', findingsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/stats', statsRouter);

app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(config.port, () => {
  console.log(`skyblock-item-tracker listening on http://localhost:${config.port}`);
  if (!config.hypixelApiKey) {
    console.log('[info] HYPIXEL_API_KEY not set — profile scans use the SkyCrypt fallback (fewer items).');
  }
  startAhWorker();
});
