/**
 * One-time migration for upgrading from the pre-multi-tournament version of
 * this app. Older deployments have Match documents with no tournamentId at
 * all. This script finds any such orphaned matches, wraps them in a single
 * archived Tournament record (so the completed tournament stays fully
 * viewable), and backfills tournamentId onto them.
 *
 * Safe to re-run: if no matches are missing a tournamentId, it does nothing.
 * Never modifies matches that already belong to a tournament.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Match = require('../models/Match');
const Tournament = require('../models/Tournament');

async function migrate() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Configure .env first.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const orphaned = await Match.countDocuments({ tournamentId: { $exists: false } });
  if (orphaned === 0) {
    console.log('No legacy matches found (nothing to migrate). Your data is already on the multi-tournament schema.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${orphaned} match(es) without a tournamentId. Wrapping them in an archived tournament...`);

  const tournament = await Tournament.create({
    name: 'AO Tennis Tournament',
    eventDates: 'July 18 & 19',
    status: 'archived' // it already finished, so it starts life as archived/read-only
  });

  const result = await Match.updateMany(
    { tournamentId: { $exists: false } },
    { $set: { tournamentId: tournament._id } }
  );

  console.log(`Linked ${result.modifiedCount} match(es) to new tournament "${tournament.name}" (id: ${tournament._id}).`);

  // Drop the old single-field unique index on matchNumber if it still exists,
  // and let Mongoose create the new compound {tournamentId, matchNumber} index.
  try {
    await Match.collection.dropIndex('matchNumber_1');
    console.log('Dropped legacy unique index on matchNumber.');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound') console.warn('Could not drop legacy index:', err.message);
  }
  await Match.syncIndexes();
  console.log('Indexes synced.');

  console.log('Migration complete. Your existing tournament is now viewable (as archived/read-only) alongside any new tournaments you create.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
