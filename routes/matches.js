const express = require('express');
const Match = require('../models/Match');
const { requireAuth } = require('../middleware/auth');
const rulesEngine = require('../utils/rulesEngine');

const router = express.Router();
const LOCK_TTL_MS = parseFloat(process.env.LOCK_TTL_SECONDS || '90') * 1000;

function lockIsActive(match) {
  return match.lock && match.lock.sessionId && match.lock.lockedAt &&
    (Date.now() - new Date(match.lock.lockedAt).getTime()) < LOCK_TTL_MS;
}

// Middleware: ensures the current session either holds the lock, or no one does.
// Attach after requireAuth. Assumes req.match has already been loaded.
function requireLockOwnership(req, res, next) {
  const match = req.match;
  if (lockIsActive(match) && match.lock.sessionId !== req.sessionId) {
    return res.status(423).json({
      error: 'This match is currently being edited in another session. Please wait or try again shortly.',
      lockedAt: match.lock.lockedAt
    });
  }
  next();
}

async function loadMatch(req, res, next) {
  const match = await Match.findOne({ matchNumber: Number(req.params.matchNumber) });
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  req.match = match;
  next();
}

function broadcast(io, match) {
  io.to(`match:${match.matchNumber}`).emit('match:update', match.toObject());
  io.to('bracket').emit('bracket:update', { matchNumber: match.matchNumber });
}

// ---- Public read endpoints ----

router.get('/:matchNumber', loadMatch, (req, res) => {
  res.json(req.match);
});

// ---- Lock endpoints (auth required) ----

router.post('/:matchNumber/lock', requireAuth, loadMatch, async (req, res) => {
  const match = req.match;
  if (lockIsActive(match) && match.lock.sessionId !== req.sessionId) {
    return res.status(423).json({ error: 'Already locked by another session.' });
  }
  match.lock = { sessionId: req.sessionId, lockedAt: new Date() };
  await match.save();
  res.json({ ok: true, lock: match.lock });
});

// Heartbeat to refresh an existing lock
router.post('/:matchNumber/lock/refresh', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  match.lock = { sessionId: req.sessionId, lockedAt: new Date() };
  await match.save();
  res.json({ ok: true, lock: match.lock });
});

router.delete('/:matchNumber/lock', requireAuth, loadMatch, async (req, res) => {
  const match = req.match;
  if (match.lock && match.lock.sessionId === req.sessionId) {
    match.lock = { sessionId: null, lockedAt: null };
    await match.save();
  }
  res.json({ ok: true });
});

// ---- Schedule / player-name editing (auth + lock ownership) ----

router.patch('/:matchNumber/schedule', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { player1Name, player2Name, scheduledStart, scheduledEnd, switchPacing, expectedVersion } = req.body;

  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }

  if (player1Name !== undefined) match.player1.name = player1Name;
  if (player2Name !== undefined) match.player2.name = player2Name;
  if (scheduledStart !== undefined) match.scheduledStart = scheduledStart;
  if (scheduledEnd !== undefined) match.scheduledEnd = scheduledEnd;
  if (switchPacing !== undefined) match.switchPacing = switchPacing;

  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match });
});

// ---- Coin toss (auth + lock ownership) ----

router.post('/:matchNumber/toss', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { tossWinner, winnerChoice, serveChoicePlayer, serveDecision, sideChoicePlayer, side, expectedVersion } = req.body;

  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }

  if (!['player1', 'player2'].includes(tossWinner)) {
    return res.status(400).json({ error: 'tossWinner must be player1 or player2.' });
  }
  if (!['serve', 'side', 'defer'].includes(winnerChoice)) {
    return res.status(400).json({ error: 'winnerChoice must be serve, side, or defer.' });
  }

  match.coinToss = {
    tossWinner,
    winnerChoice,
    serveChoice: { player: serveChoicePlayer || null, decision: serveDecision || null },
    sideChoice: { player: sideChoicePlayer || null, side: side || null },
    recordedAt: new Date()
  };
  match.status = 'toss_done';
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match });
});

// ---- Start match: locks in first server from toss, moves to in_progress ----

router.post('/:matchNumber/start', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  if (!match.coinToss || !match.coinToss.serveChoice || !match.coinToss.serveChoice.decision) {
    return res.status(400).json({ error: 'Coin toss must be fully recorded before starting the match.' });
  }
  const server = match.coinToss.serveChoice.decision === 'serve'
    ? match.coinToss.serveChoice.player
    : rulesEngine.other(match.coinToss.serveChoice.player);

  match.score = rulesEngine.newMatchScore(server);
  match.status = 'in_progress';
  match.history = [];
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match });
});

// ---- Scoring: add a point ----

router.post('/:matchNumber/point', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { scorer, expectedVersion } = req.body;

  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }
  if (!['player1', 'player2'].includes(scorer)) {
    return res.status(400).json({ error: 'scorer must be player1 or player2.' });
  }
  if (match.status !== 'in_progress') {
    return res.status(400).json({ error: 'Match is not in progress (record the coin toss and start the match first).' });
  }

  // Push a snapshot for undo, capped at 50 entries
  match.history.push(JSON.parse(JSON.stringify(match.score)));
  if (match.history.length > 50) match.history.shift();

  const { score, events, switchSuggestion } = rulesEngine.addPoint(
    match.score.toObject ? match.score.toObject() : match.score,
    match.phase,
    scorer,
    match.switchPacing
  );

  match.score = score;
  if (score.winner) {
    match.status = 'completed';
    await propagateWinner(match);
  }
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match, events, switchSuggestion });
});

// ---- Undo last point ----

router.post('/:matchNumber/undo', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  if (!match.history || match.history.length === 0) {
    return res.status(400).json({ error: 'No previous point to undo.' });
  }
  const previous = match.history.pop();
  match.score = previous;
  if (match.status === 'completed') match.status = 'in_progress';
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match });
});

// When a match completes, push the winner's name into the next match's slot.
async function propagateWinner(match) {
  if (!match.nextMatch || !match.nextMatchSlot) return;
  const winnerName = match.score.winner === 'player1' ? match.player1.name : match.player2.name;
  const nextMatch = await Match.findOne({ matchNumber: match.nextMatch });
  if (!nextMatch) return;
  nextMatch[match.nextMatchSlot].name = winnerName;
  nextMatch.version += 1;
  await nextMatch.save();
}

// ---- Manually finish a match (e.g. retirement/walkover), locking it from further scoring ----

router.post('/:matchNumber/finish', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { winner, expectedVersion } = req.body;

  if (match.status === 'completed') {
    return res.status(400).json({ error: 'Match is already marked as finished.' });
  }
  if (match.status !== 'in_progress') {
    return res.status(400).json({ error: 'Match must be in progress before it can be marked finished.' });
  }
  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }

  if (!match.score.winner) {
    if (!['player1', 'player2'].includes(winner)) {
      return res.status(400).json({ error: 'A winner must be selected to finish a match with no completed score.' });
    }
    match.score.winner = winner;
  }

  match.status = 'completed';
  match.version += 1;
  await match.save();
  await propagateWinner(match);
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match });
});

module.exports = router;
