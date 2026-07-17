const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  p1Points: { type: Number, default: 0 },
  p2Points: { type: Number, default: 0 },
  server: { type: String, enum: ['player1', 'player2', null], default: null }
}, { _id: false });

const tiebreakSchema = new mongoose.Schema({
  p1: { type: Number, default: 0 },
  p2: { type: Number, default: 0 },
  firstServer: { type: String, enum: ['player1', 'player2', null], default: null },
  target: { type: Number, default: 7 }, // 5 for fast4 set TB, 7 for regular set TB, 10 for match TB
  suddenDeath: { type: Boolean, default: false } // true only for fast4 5-pt breaker style
}, { _id: false });

const setSchema = new mongoose.Schema({
  p1Games: { type: Number, default: 0 },
  p2Games: { type: Number, default: 0 },
  wonBy: { type: String, enum: ['player1', 'player2', null], default: null },
  tiebreak: { type: tiebreakSchema, default: null }
}, { _id: false });

const coinTossSchema = new mongoose.Schema({
  tossWinner: { type: String, enum: ['player1', 'player2', null], default: null },
  winnerChoice: { type: String, enum: ['serve', 'side', 'defer', null], default: null },
  // If winnerChoice === 'defer', opponent becomes the effective chooser and the
  // same serveChoice/sideChoice fields below still apply, just attributed differently.
  serveChoice: {
    player: { type: String, enum: ['player1', 'player2', null], default: null },
    decision: { type: String, enum: ['serve', 'receive', null], default: null }
  },
  sideChoice: {
    player: { type: String, enum: ['player1', 'player2', null], default: null },
    side: { type: String, enum: ['pool-end', 'entrance-end', null], default: null }
  },
  recordedAt: { type: Date, default: null }
}, { _id: false });

const matchSchema = new mongoose.Schema({
  matchNumber: { type: Number, required: true, unique: true },
  round: { type: String, required: true }, // "Play-In" | "Round of 16" | "Quarterfinal" | "Semifinal" | "Final"
  phase: { type: Number, enum: [1, 2], required: true }, // 1 = Fast4, 2 = Regular
  session: { type: String, default: '' }, // "Morning" | "Evening"

  scheduledStart: { type: String, default: '' }, // editable, free text e.g. "06:30 AM"
  scheduledEnd: { type: String, default: '' },

  player1: {
    name: { type: String, default: 'TBD' },
    sourceMatch: { type: Number, default: null } // if this slot is filled by a winner
  },
  player2: {
    name: { type: String, default: 'TBD' },
    sourceMatch: { type: Number, default: null }
  },

  // Where this match's winner advances to, and which slot they fill.
  nextMatch: { type: Number, default: null },
  nextMatchSlot: { type: String, enum: ['player1', 'player2', null], default: null },

  status: { type: String, enum: ['scheduled', 'toss_done', 'in_progress', 'completed'], default: 'scheduled' },

  coinToss: { type: coinTossSchema, default: () => ({}) },

  score: {
    sets: { type: [setSchema], default: [] },
    currentSetIndex: { type: Number, default: 0 },
    game: { type: gameSchema, default: () => ({}) },
    matchTiebreak: { type: tiebreakSchema, default: null },
    inSetTiebreak: { type: Boolean, default: false },
    inMatchTiebreak: { type: Boolean, default: false },
    winner: { type: String, enum: ['player1', 'player2', null], default: null }
  },

  // Snapshots of score state before each point, for undo. Capped in size.
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },

  switchPacing: { type: String, enum: ['odd_game', 'every_two_games'], default: 'odd_game' },

  lock: {
    sessionId: { type: String, default: null },
    lockedAt: { type: Date, default: null }
  },

  version: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);
