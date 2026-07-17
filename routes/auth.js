const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Config = require('../models/Config');
const { createSessionToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/me - lets the frontend check if it currently holds a valid admin session
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, sessionId: req.sessionId });
});

// GET /api/auth/status - tells the frontend whether setup has happened yet
router.get('/status', async (req, res) => {
  const config = await Config.findOne();
  res.json({ setupComplete: !!config });
});

// POST /api/auth/setup { passcode }
// Can only ever succeed once. Once a Config document exists, this always 403s,
// regardless of what's sent - enforced here server-side, not just hidden in the UI.
router.post('/setup', async (req, res) => {
  const existing = await Config.findOne();
  if (existing) {
    return res.status(403).json({ error: 'Passcode has already been set for this deployment and cannot be changed.' });
  }
  const { passcode } = req.body;
  if (!passcode || typeof passcode !== 'string' || passcode.length < 4) {
    return res.status(400).json({ error: 'Passcode must be at least 4 characters.' });
  }
  const passcodeHash = await bcrypt.hash(passcode, 10);
  await Config.create({ passcodeHash, isLocked: true });
  res.json({ ok: true, message: 'Passcode set. This can never be changed again for this deployment.' });
});

// POST /api/auth/login { passcode }
router.post('/login', async (req, res) => {
  const config = await Config.findOne();
  if (!config) {
    return res.status(400).json({ error: 'Admin passcode has not been set up yet.' });
  }
  const { passcode } = req.body;
  if (!passcode) return res.status(400).json({ error: 'Passcode required.' });

  const valid = await bcrypt.compare(passcode, config.passcodeHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect passcode.' });

  const sessionId = crypto.randomBytes(16).toString('hex');
  const token = createSessionToken(sessionId);
  res.cookie('adminSession', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: parseFloat(process.env.SESSION_HOURS || '12') * 60 * 60 * 1000
  });
  res.json({ ok: true, sessionId });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('adminSession');
  res.json({ ok: true });
});

module.exports = router;
