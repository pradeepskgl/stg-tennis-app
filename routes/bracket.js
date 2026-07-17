const express = require('express');
const Match = require('../models/Match');

const router = express.Router();

// GET /api/bracket - full schedule/bracket, public, read-only
router.get('/', async (req, res) => {
  const matches = await Match.find().sort({ matchNumber: 1 }).lean();
  res.json(matches);
});

module.exports = router;
