const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SESSION_HOURS = parseFloat(process.env.SESSION_HOURS || '12');

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function createSessionToken(sessionId) {
  const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  return sign({ sessionId, exp });
}

// Express middleware: requires a valid admin session cookie.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.adminSession;
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'Not authenticated. Please log in with the admin passcode.' });
  }
  req.sessionId = payload.sessionId;
  next();
}

module.exports = { createSessionToken, verify, requireAuth };
