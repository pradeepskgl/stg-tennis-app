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

## 9. Multiple tournaments

The app supports running many tournaments over time, each with its own isolated bracket:

- **One tournament is "active"** at a time — that's the one admins can score. The home page
  (`/`) has a tournament selector dropdown; it defaults to the active one.
- **Admins start a new tournament** via the "+ New Tournament" button on the home page. This
  archives whichever tournament is currently active (its matches, scores, coin tosses, and
  rankings are kept exactly as-is — nothing is deleted or altered) and seeds a fresh 17-match
  bracket under a brand-new tournament id, with all player names set to "TBD" ready for editing.
- **Archived tournaments are permanently read-only.** The bracket, scores, and rankings stay
  fully viewable from the dropdown, but the server rejects any attempt to edit them (schedule,
  coin toss, scoring, undo, finish) with a 403 - enforced server-side, not just hidden in the UI.
- Every match/tournament link carries a `?t=<tournamentId>` parameter (e.g. `/match.html?t=...&m=3`,
  `/rankings.html?t=...`), so you can bookmark or share a specific tournament's pages directly.

## 10. Choosing match format per tournament

When creating a new tournament, the admin picks two rules that apply uniformly to every match
in that tournament (replacing the old fixed "early rounds = Fast4, semis/final = Regular" split):

- **Match format:**
  - *Fast4* — No-Ad scoring, first to 4 games wins a set (no win-by-2), 5-point sudden-death
    tiebreak at 3-3.
  - *Regular* — Ad scoring, first to 6 games with win-by-2, standard 7-point tiebreak at 6-6.
- **If sets tie 1-1:**
  - *10-Point Match Tiebreak* (original rulebook default) — skip a 3rd set entirely and settle
    the match with a 10-point breaker (win by 2).
  - *Full 3rd set* — play a real, complete 3rd set using the match format above; whoever wins it
    takes the match (a conventional best-of-3 experience).

Both settings are stored on the tournament and copied onto every match it seeds, so the scoring
engine applies the right rules automatically without any per-match configuration.

## 11. Rankings

Each tournament has a rankings page (`/rankings.html?t=<tournamentId>`, linked from the home page)
showing final standings:

- **Ranking rule:** furthest round reached (Champion > Runner-up > Semifinalist > Quarterfinalist
  > Round of 16 > Play-In), then game differential (games won minus lost across the tournament) as
  a tiebreaker within the same round.
- **"Recompute from matches"** (admin only) runs this calculation fresh from current match data and
  saves it. Safe to re-run any time, including on an archived tournament.
- **Genuine ties** (identical round reached and identical game differential) are automatically
  detected and share the same rank number, flagged with a note - useful when the "right" tiebreaker
  (e.g. original seeding) isn't captured in the match data itself.
- Admins can edit the **Note** column inline (e.g. to record how a tie was broken) and click
  "Save edits" - this only touches notes, not the computed ranks/stats, unless you also click
  Recompute.

## 12. Match timer

Every match now tracks real wall-clock start/end times, separate from the editable scheduled
time strings:

- Timing starts automatically the moment "Start Match" is pressed, and stops the moment the match
  is won (or manually marked finished).
- The match page shows a live-ticking **Elapsed** timer while a match is in progress, and a frozen
  **Duration** once it's completed.
- Each format's intended window is shown alongside it (45 min for Fast4, 90 min for Regular per the
  rulebook), with a visual flag if the match runs over that window - handy for keeping the day's
  schedule on track.
- Undoing the last point of a completed match clears its end time and resumes the live timer, since
  the match is back "in progress".

## 13. Upgrading from an earlier single-tournament deployment

If you deployed an earlier version of this app (before multi-tournament support) and already have
match data in MongoDB, run this **once** after upgrading:

```bash
npm run migrate-legacy
```

This finds any matches that don't yet belong to a tournament, wraps them in a single tournament
record (marked archived, since it already finished), and links them all to it - so your existing
results become the first entry in the tournament dropdown instead of disappearing. Safe to run more
than once; it does nothing if there's nothing left to migrate.

## 14. Export / import between app instances

Any tournament's full data - every match, its score, complete point-by-point history, and coin
toss - can be exported as a single JSON file and imported into a different deployment (a different
Render instance, a different MongoDB Atlas cluster, a local copy, etc.).

- **Export**: click "Export" next to the tournament selector on the home page (works for anyone,
  same as viewing the public bracket - nothing sensitive is included). Downloads a `.json` file.
- **Import** (admin only): click "Import", choose a previously exported `.json` file. This always
  creates a **brand-new tournament** with a fresh id in the target instance - it never overwrites
  or merges into an existing tournament, so it's safe to import the same file more than once (you'll
  just get duplicate tournaments) or import into an instance that already has other tournaments.
  - If the exported tournament was `active`, importing it archives whatever tournament is currently
    active in the target instance first (same rule as creating a new tournament).
  - If the exported tournament was `archived`, it imports as archived (read-only) directly.
  - Saved rankings are imported too, if the source tournament had any computed.
- This is the recommended way to migrate a completed tournament's results to a new deployment, or to
  keep an offline backup of a tournament outside MongoDB.
