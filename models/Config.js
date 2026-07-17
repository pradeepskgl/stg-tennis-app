const mongoose = require('mongoose');

// Singleton document. There should only ever be one Config document.
// Once passcodeHash is set, isLocked becomes true and can never be set again
// (enforced in routes/auth.js, not just here).
const configSchema = new mongoose.Schema({
  passcodeHash: { type: String, required: true },
  isLocked: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Config', configSchema);
