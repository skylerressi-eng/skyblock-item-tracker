import { Router } from 'express';
import { repo } from '../db/index.js';
import { getWorkerStatus } from '../scanner/ahWorker.js';
import { config } from '../config.js';

export const statsRouter = Router();

// GET /api/stats — database counts + worker status + capability flags.
statsRouter.get('/', (req, res) => {
  res.json({
    ok: true,
    ...repo.stats(),
    ahWorker: getWorkerStatus(),
    capabilities: {
      hypixelKey: Boolean(config.hypixelApiKey),
      rareTiers: config.rareTiers,
    },
  });
});
