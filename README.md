# Tennis Tournament Tracker

A Node.js + MongoDB web app that tracks the 18-player knockout tournament exactly as defined
in the tournament rulebook: Fast4 rules for Play-In/Round of 16/Quarterfinals, Regular
(Ad-scoring) rules for Semifinals/Final, both tiebreak types, the 10-point match tiebreak
when sets split 1-1, coin-toss recording, switch-ends suggestions, live scoreboards, and
a one-time admin passcode.

## 1. Setup

Configure your environment **before** installing, so seeding can run automatically:

```bash
cd tennis-app
cp .env.example .env
```

Edit `.env`:
- `MONGODB_URI` — your MongoDB Atlas connection string (**required**)
- `SESSION_SECRET` — any long random string (used to sign admin session cookies)
- `PORT` — defaults to 3000
- `SESSION_HOURS` — how long an admin login stays valid (default 12)
- `LOCK_TTL_SECONDS` — how long a soft edit-lock lasts before it expires (default 90)

Then install:

```bash
npm install
```

## 2. Seeding the bracket

Seeding runs **automatically** as part of `npm install` (a `postinstall` hook), creating all
17 matches with the players, times, and rounds from the schedule. It's idempotent and safe
to re-run — it skips any match number that already exists, so it will never overwrite scores
or edits you've made.

If `.env` wasn't set up yet when you ran `npm install` (or MongoDB wasn't reachable at that
moment), `npm install` still completes normally — you'll just see a warning instead of a
crash. In that case, seed manually once your `.env` is ready:

```bash
npm run seed
```

## 3. Run the app

```bash
npm start
```

Visit `http://localhost:3000`.

## 4. First-time admin passcode

The first time anyone opens the app, a **"Set Passcode"** box appears on the home page.
Whoever sets it first locks it in for the whole deployment — the server rejects any
later attempt to set it again (`403`), regardless of what's submitted. Store the passcode
somewhere safe; there is no reset flow by design, matching the "set once at deployment" requirement.

Admins log in via the same box (passcode → session cookie, default valid 12 hours).
Spectators need no login — the bracket, schedule, and live scores are always publicly viewable.

## 5. How scoring works

Click into any match from the bracket to see its page:

1. **Coin toss** — admin records who won the toss and what they chose (serve/receive,
   starting side, or defer), including the resulting side (Pool End / Entrance End).
   The "Start Match" button is disabled until this is fully recorded.
2. **Start Match** — locks in the first server and begins point-by-point scoring.
3. **Point buttons** — one tap per point. The engine automatically handles:
   - No-Ad scoring and 4-game sets for Fast4 rounds; Ad scoring and 6-game (win-by-2) sets for Semis/Final
   - 5-point sudden-death set tiebreak at 3-3 (Fast4) / 7-point set tiebreak at 6-6 (Regular)
   - 10-point match tiebreak (win by 2) instead of a 3rd set when sets split 1-1
   - A switch-ends banner at the correct moments (odd games with a water-sip pause for Fast4;
     odd games with a 90s sit-down for Regular, skipped after game 1 of a set; the specific
     tiebreak switch points)
4. **Undo** — reverts the last point if mis-tapped.
5. When a match completes, the winner's name automatically appears in the next match's slot.

## 6. Locking

- **Soft lock**: opening a match as admin claims a ~90s lock (auto-refreshed every 60s while
  the page is open, released on navigating away). A second admin session sees "currently being
  edited elsewhere" and can't submit changes until it's free.
- **Version check**: every save includes the version it was read at. If someone else saved
  first, the request is rejected with a 409 so nobody's edit is silently overwritten.

## 7. Project structure

```
server.js              Express + Socket.io entry point
models/                 Mongoose schemas (Config, Match)
routes/                 auth, bracket, matches API routes
middleware/auth.js      Session cookie signing/verification
utils/rulesEngine.js    Pure scoring logic (unit-testable, no DB/Express deps)
utils/seedBracket.js    One-time/idempotent bracket seeding from the PDF schedule
public/                 Static frontend (index.html = bracket, match.html = live scoreboard)
test_engine.js          Unit tests for the rules engine (`node test_engine.js`)
```

## 8. Notes / things you may want to adjust

- Player seeding (1-14 byes, 15-18 play-in) is expressed simply as the fixed bracket
  structure from the schedule — there's no separate "seed number" field, since the PDF's
  schedule already encodes who plays whom.
- `switchPacing` is editable per match on the match page (only meaningful for Fast4 matches);
  it defaults to "odd game / water sip" per your confirmed preference.
- This uses cookie-based admin sessions (single shared passcode), not per-user accounts —
  matching the "one passcode, set once" requirement rather than a multi-admin system.
