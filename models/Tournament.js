const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g. "AO Tennis Tournament - July 2026"
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  eventDates: { type: String, default: '' }, // free text, e.g. "July 18 & 19, 2026"

  // Rule configuration chosen at creation time, applied uniformly to every
  // match seeded under this tournament.
  setFormat: { type: String, enum: ['fast4', 'regular'], default: 'fast4' },
  // 'match_tiebreak': sets tied 1-1 -> 10-point match tiebreak instead of a 3rd set (original rulebook behavior)
  // 'full_set': sets tied 1-1 -> play a real 3rd set using the same set format, winner takes the match
  decidingSet: { type: String, enum: ['match_tiebreak', 'full_set'], default: 'match_tiebreak' },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
