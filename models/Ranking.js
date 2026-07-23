const mongoose = require('mongoose');

const rankingEntrySchema = new mongoose.Schema({
  rank: { type: Number, required: true },
  playerName: { type: String, required: true },
  furthestRound: { type: String, required: true }, // e.g. "Champion", "Runner-up", "Semifinalist"
  gamesWon: { type: Number, default: 0 },
  gamesLost: { type: Number, default: 0 },
  gameDiff: { type: Number, default: 0 },
  note: { type: String, default: '' } // e.g. "3-way tie, broken by seed"
}, { _id: false });

const rankingSchema = new mongoose.Schema({
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, unique: true },
  entries: { type: [rankingEntrySchema], default: [] },
  computedAt: { type: Date, default: null }, // last time auto-compute ran
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ranking', rankingSchema);
