import { Router } from 'express';
import { scanProfile } from '../scanner/scanProfile.js';

export const scanRouter = Router();

// POST /api/scan/:username  — scan a player on demand and store findings.
scanRouter.post('/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const result = await scanProfile(username, { source: 'manual' });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.status === 404 || /not found/i.test(err.message) ? 404 : 502;
    res.status(status).json({ ok: false, error: err.message, code: err.code || null });
  }
});
