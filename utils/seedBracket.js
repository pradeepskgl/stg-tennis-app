/**
 * One-time (idempotent) seeding of the 17-match bracket exactly as laid out
 * in the tournament schedule PDF. Safe to re-run: it only inserts matches
 * that don't already exist (by matchNumber) - it will NOT overwrite scores
 * or edited player names/times on existing matches.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Match = require('../models/Match');

const raw = [
  // matchNumber, round, phase, session, start, end, p1, p2, p1Source, p2Source, nextMatch, nextSlot
  [1, 'Play-In', 1, 'Morning', '06:30 AM', '07:15 AM', 'Alok', 'Anantha Krishnan', null, null, 7, 'player2'],
  [2, 'Play-In', 1, 'Morning', '07:15 AM', '08:00 AM', 'Vishnu', 'Girish S', null, null, 6, 'player2'],
  [3, 'Round of 16', 1, 'Morning', '08:00 AM', '08:45 AM', 'Pramod', 'Mathew', null, null, 11, 'player2'],
  [4, 'Round of 16', 1, 'Morning', '08:45 AM', '09:30 AM', 'Chethan', 'Vasista Sandeep', null, null, 12, 'player1'],
  [5, 'Round of 16', 1, 'Morning', '09:30 AM', '10:15 AM', 'Manjunath P', 'Nagaraj', null, null, 12, 'player2'],
  [6, 'Round of 16', 1, 'Evening', '04:00 PM', '04:45 PM', 'Girish LC', 'TBD', null, 2, 11, 'player1'],
  [7, 'Round of 16', 1, 'Evening', '04:45 PM', '05:30 PM', 'Mahesh', 'TBD', null, 1, 13, 'player1'],
  [8, 'Round of 16', 1, 'Evening', '05:30 PM', '06:15 PM', 'Swamy', 'Prajwal', null, null, 13, 'player2'],
  [9, 'Round of 16', 1, 'Evening', '06:15 PM', '07:00 PM', 'Ashish', 'Lokendra', null, null, 14, 'player1'],
  [10, 'Round of 16', 1, 'Evening', '07:00 PM', '07:45 PM', 'Shreenath', 'Pradeep', null, null, 14, 'player2'],
  [11, 'Quarterfinal', 1, 'Morning', '06:30 AM', '07:15 AM', 'TBD', 'TBD', 6, 3, 15, 'player1'],
  [12, 'Quarterfinal', 1, 'Morning', '07:15 AM', '08:00 AM', 'TBD', 'TBD', 4, 5, 15, 'player2'],
  [13, 'Quarterfinal', 1, 'Morning', '08:00 AM', '08:45 AM', 'TBD', 'TBD', 7, 8, 16, 'player1'],
  [14, 'Quarterfinal', 1, 'Morning', '08:45 AM', '09:30 AM', 'TBD', 'TBD', 9, 10, 16, 'player2'],
  [15, 'Semifinal', 2, 'Evening', '04:00 PM', '05:30 PM', 'TBD', 'TBD', 11, 12, 17, 'player1'],
  [16, 'Semifinal', 2, 'Evening', '05:30 PM', '07:00 PM', 'TBD', 'TBD', 13, 14, 17, 'player2'],
  [17, 'Final', 2, 'Evening', '07:00 PM', '08:30 PM', 'TBD', 'TBD', 15, 16, null, null]
];

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.warn(
      '\n[seed] Skipped: MONGODB_URI is not set (no .env found yet).\n' +
      '[seed] Once you create .env with your Atlas connection string, run: npm run seed\n'
    );
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    console.warn(
      `\n[seed] Skipped: could not connect to MongoDB (${err.message}).\n` +
      '[seed] Fix MONGODB_URI in .env, then run: npm run seed\n'
    );
    return;
  }
  console.log('Connected to MongoDB for seeding.');

  for (const row of raw) {
    const [matchNumber, round, phase, session, scheduledStart, scheduledEnd, p1, p2, p1Source, p2Source, nextMatch, nextMatchSlot] = row;
    const exists = await Match.findOne({ matchNumber });
    if (exists) {
      console.log(`Match ${matchNumber} already exists, skipping.`);
      continue;
    }
    await Match.create({
      matchNumber,
      round,
      phase,
      session,
      scheduledStart,
      scheduledEnd,
      player1: { name: p1, sourceMatch: p1Source },
      player2: { name: p2, sourceMatch: p2Source },
      nextMatch,
      nextMatchSlot,
      switchPacing: 'odd_game'
    });
    console.log(`Created match ${matchNumber}: ${p1 || 'TBD'} vs ${p2 || 'TBD'}`);
  }

  console.log('Seeding complete.');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
