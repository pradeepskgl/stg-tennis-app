const express = require('express');
const Tournament = require('../models/Tournament');
const Match = require('../models/Match');
const Ranking = require('../models/Ranking');
const { requireAuth } = require('../middleware/auth');
const { seedTournamentBracket } = require('../utils/seedBracket');
const { computeRankings } = require('../utils/rankings');

const router = express.Router();

// GET /api/tournaments - list all tournaments, newest first
router.get('/', async (req, res) => {
  const tournaments = await Tournament.find().sort({ createdAt: -1 }).lean();
  res.json(tournaments);
});

// GET /api/tournaments/active - convenience lookup for the frontend's default view
router.get('/active', async (req, res) => {
  const active = await Tournament.findOne({ status: 'active' }).sort({ createdAt: -1 }).lean();
  res.json(active || null);
});

// POST /api/tournaments - create a new tournament (admin only).
// Archives whichever tournament is currently active, then seeds a fresh
// 17-match bracket (all players TBD) under a brand-new tournament id.
// Existing tournaments and their match data are never touched or deleted.
router.post('/', requireAuth, async (req, res) => {
  const { name, eventDates, setFormat, decidingSet } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'A tournament name is required.' });
  }
  const finalSetFormat = ['fast4', 'regular'].includes(setFormat) ? setFormat : 'fast4';
  const finalDecidingSet = ['match_tiebreak', 'full_set'].includes(decidingSet) ? decidingSet : 'match_tiebreak';

  await Tournament.updateMany({ status: 'active' }, { status: 'archived' });

  const tournament = await Tournament.create({
    name: name.trim(),
    eventDates: eventDates || '',
    status: 'active',
    setFormat: finalSetFormat,
    decidingSet: finalDecidingSet
  });

  await seedTournamentBracket(tournament._id, { setFormat: finalSetFormat, decidingSet: finalDecidingSet });

  res.json({ ok: true, tournament });
});

// GET /api/tournaments/:id - single tournament's metadata
router.get('/:id', async (req, res) => {
  const tournament = await Tournament.findById(req.params.id).lean();
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
  res.json(tournament);
});

// ---- Rankings ----

// GET /api/tournaments/:id/rankings - public read of stored rankings (if any)
router.get('/:id/rankings', async (req, res) => {
  const ranking = await Ranking.findOne({ tournamentId: req.params.id }).lean();
  res.json(ranking || null);
});

// POST /api/tournaments/:id/rankings/compute - recompute from match data and store (admin only)
router.post('/:id/rankings/compute', requireAuth, async (req, res) => {
  const tournamentId = req.params.id;
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const matches = await Match.find({ tournamentId }).lean();
  const entries = computeRankings(matches);

  const ranking = await Ranking.findOneAndUpdate(
    { tournamentId },
    { entries, computedAt: new Date(), updatedAt: new Date() },
    { upsert: true, new: true }
  );

  res.json({ ok: true, ranking });
});

// POST /api/tournaments/:id/rankings - save manually-edited rankings (admin only),
// e.g. after breaking a tie or adding a note.
router.post('/:id/rankings', requireAuth, async (req, res) => {
  const tournamentId = req.params.id;
  const { entries } = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries must be an array.' });
  }

  const ranking = await Ranking.findOneAndUpdate(
    { tournamentId },
    { entries, updatedAt: new Date() },
    { upsert: true, new: true }
  );

  res.json({ ok: true, ranking });
});

// ---- Export / Import (for moving a tournament's full data to another app instance) ----

// GET /api/tournaments/:id/export - full portable bundle: tournament config,
// every match (including score, point history, and coin toss), and rankings
// if computed. Public read, same as bracket/rankings - contains no secrets.
router.get('/:id/export', async (req, res) => {
  const tournamentId = req.params.id;
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

  const matches = await Match.find({ tournamentId }).sort({ matchNumber: 1 }).lean();
  const ranking = await Ranking.findOne({ tournamentId }).lean();

  // Strip fields that are instance-specific or will be regenerated on import.
  const cleanMatches = matches.map(m => {
    const { _id, __v, tournamentId, lock, version, createdAt, updatedAt, ...rest } = m;
    return rest;
  });

  res.json({
    exportFormatVersion: 1,
    exportedAt: new Date().toISOString(),
    tournament: {
      name: tournament.name,
      eventDates: tournament.eventDates,
      status: tournament.status,
      setFormat: tournament.setFormat,
      decidingSet: tournament.decidingSet
    },
    matches: cleanMatches,
    ranking: ranking ? { entries: ranking.entries } : null
  });
});

// POST /api/tournaments/import - admin only. Creates a brand-new tournament
// (new id, so it never collides with anything in this or any other instance)
// from a previously exported bundle, recreating every match with its full
// score/point-history/coin-toss state intact.
router.post('/import', requireAuth, async (req, res) => {
  const bundle = req.body;
  if (!bundle || !bundle.tournament || !Array.isArray(bundle.matches)) {
    return res.status(400).json({ error: 'Invalid import file: expected a tournament export bundle.' });
  }
  const t = bundle.tournament;
  if (!t.name || typeof t.name !== 'string') {
    return res.status(400).json({ error: 'Invalid import file: tournament name is missing.' });
  }

  const importedStatus = t.status === 'active' ? 'active' : 'archived';
  if (importedStatus === 'active') {
    await Tournament.updateMany({ status: 'active' }, { status: 'archived' });
  }

  const tournament = await Tournament.create({
    name: t.name,
    eventDates: t.eventDates || '',
    status: importedStatus,
    setFormat: ['fast4', 'regular'].includes(t.setFormat) ? t.setFormat : 'fast4',
    decidingSet: ['match_tiebreak', 'full_set'].includes(t.decidingSet) ? t.decidingSet : 'match_tiebreak'
  });

  let importedCount = 0;
  for (const m of bundle.matches) {
    if (!m.matchNumber || !m.round) continue; // skip malformed entries rather than failing the whole import
    await Match.create({
      ...m,
      tournamentId: tournament._id,
      lock: { sessionId: null, lockedAt: null },
      version: 0
    });
    importedCount += 1;
  }

  if (bundle.ranking && Array.isArray(bundle.ranking.entries)) {
    await Ranking.create({
      tournamentId: tournament._id,
      entries: bundle.ranking.entries,
      computedAt: null,
      updatedAt: new Date()
    });
  }

  res.json({ ok: true, tournament, importedMatches: importedCount });
});

module.exports = router;
