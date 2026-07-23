const express = require('express');
const Match = require('../models/Match');

const router = express.Router();

// GET /api/tournaments/:tournamentId/bracket - full schedule/bracket for one tournament, public, read-only
router.get('/:tournamentId/bracket', async (req, res) => {
  const matches = await Match.find({ tournamentId: req.params.tournamentId }).sort({ matchNumber: 1 }).lean();
  res.json(matches);
});

module.exports = router;
