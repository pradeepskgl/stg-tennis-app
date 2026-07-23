/**
 * Pure scoring engine for the tournament. No DB / Express dependencies here,
 * so it can be unit-tested in isolation.
 *
 * Set format (chosen per-tournament, applies to every match):
 *   Fast4 (phase 1): No-Ad game scoring, first to 4 games wins set, no win-by-2 on games;
 *     set reaches 3-3 -> 5-point sudden-death set tiebreak.
 *   Regular (phase 2): Ad-scoring, first to 6 games + win-by-2 wins set;
 *     set reaches 6-6 -> standard 7-point set tiebreak (win by 2).
 *
 * Deciding-set rule (chosen per-tournament, applies whenever sets reach 1-1):
 *   'match_tiebreak' (default): play a 10-point match tiebreak instead of a 3rd set.
 *   'full_set': play a real 3rd set using the same set format above; winner takes the match.
 */

const other = (p) => (p === 'player1' ? 'player2' : 'player1');

function freshGame(server) {
  return { p1Points: 0, p2Points: 0, server };
}

function freshSet() {
  return { p1Games: 0, p2Games: 0, wonBy: null, tiebreak: null };
}

function newMatchScore(firstServer) {
  return {
    sets: [freshSet()],
    currentSetIndex: 0,
    game: freshGame(firstServer),
    matchTiebreak: null,
    inSetTiebreak: false,
    inMatchTiebreak: false,
    winner: null
  };
}

// ---- Tiebreak serving rotation (shared by 5pt / 7pt / 10pt breakers) ----
// Point 1 served by firstServer. Then alternates in blocks of 2, always
// starting on the left side per the rules (side handling is advisory only
// in this engine; we just return who serves).
function tiebreakServerForPoint(pointNumber, firstServer) {
  if (pointNumber <= 1) return firstServer;
  const idx = pointNumber - 2; // 0-based, starting from point 2
  const group = Math.floor(idx / 2);
  const serverIsFirst = group % 2 === 1;
  return serverIsFirst ? firstServer : other(firstServer);
}

// Returns true if a side-switch should happen right after this point number.
function isTiebreakSwitchPoint(pointNumber, targetPoints) {
  if (targetPoints === 5) {
    // 5-point sudden-death breaker: switch once, after the 4th total point.
    return pointNumber === 4;
  }
  // 7-point and 10-point breakers: switch after point 1, then every 6 points.
  return pointNumber === 1 || (pointNumber - 1) % 6 === 0;
}

function pointLabel(count, otherCount, noAd) {
  const labels = ['0', '15', '30', '40'];
  if (count < 3 && otherCount < 3) return labels[count];
  if (count < 3) return labels[count];
  if (otherCount < 3) return '40';
  // both >= 3
  if (count === otherCount) return 'Deuce';
  if (noAd) return '40'; // transient; game ends same point that breaks this tie
  return count > otherCount ? 'Ad' : '40';
}

/**
 * Applies one point to the match score state (mutates a deep-cloned copy and
 * returns it, plus a list of human-readable events and a switch-ends hint).
 *
 * @param {object} score - current score object (score sub-document, plain JS object)
 * @param {number} phase - 1 (Fast4) or 2 (Regular)
 * @param {string} scorer - 'player1' | 'player2'
 * @param {string} switchPacing - 'odd_game' | 'every_two_games' (Fast4 only; Regular always odd_game)
 * @param {string} decidingSet - 'match_tiebreak' (default, sets 1-1 -> 10pt breaker) or
 *   'full_set' (sets 1-1 -> play a real 3rd set instead)
 */
function addPoint(score, phase, scorer, switchPacing, decidingSet) {
  decidingSet = decidingSet || 'match_tiebreak';
  const s = JSON.parse(JSON.stringify(score)); // deep clone, never mutate caller's object
  const events = [];
  let switchSuggestion = null;
  const noAd = phase === 1;
  const winnerP = scorer;
  const loserP = other(scorer);

  if (s.winner) {
    return { score: s, events: ['Match already completed.'], switchSuggestion: null };
  }

  // ---- 1. Match tiebreak in progress ----
  if (s.inMatchTiebreak) {
    const tb = s.matchTiebreak;
    tb[winnerP === 'player1' ? 'p1' : 'p2'] += 1;
    const total = tb.p1 + tb.p2;
    events.push(`Match tiebreak point to ${winnerP}: ${tb.p1}-${tb.p2}`);

    if (isTiebreakSwitchPoint(total, 10)) {
      switchSuggestion = 'Switch ends now (match tiebreak).';
    }

    const lead = Math.abs(tb.p1 - tb.p2);
    const high = Math.max(tb.p1, tb.p2);
    if (high >= 10 && lead >= 2) {
      s.winner = winnerP;
      events.push(`${winnerP} wins the match tiebreak ${tb.p1}-${tb.p2} and the match!`);
    }
    return { score: s, events, switchSuggestion };
  }

  // ---- 2. Set tiebreak in progress ----
  if (s.inSetTiebreak) {
    const set = s.sets[s.currentSetIndex];
    const tb = set.tiebreak;
    tb[winnerP === 'player1' ? 'p1' : 'p2'] += 1;
    const total = tb.p1 + tb.p2;
    events.push(`Set tiebreak point to ${winnerP}: ${tb.p1}-${tb.p2}`);

    if (isTiebreakSwitchPoint(total, tb.target)) {
      switchSuggestion = 'Switch ends now (tiebreak).';
    }
    if (tb.suddenDeath && tb.p1 === 4 && tb.p2 === 4) {
      events.push('Score is 4-4: next point is sudden death. Receiver chooses return side.');
    }

    let setWon = false;
    if (tb.suddenDeath) {
      // 5-point sudden death: first to 5, no win-by-2 required.
      if (tb.p1 >= 5 || tb.p2 >= 5) setWon = true;
    } else {
      const lead = Math.abs(tb.p1 - tb.p2);
      const high = Math.max(tb.p1, tb.p2);
      if (high >= tb.target && lead >= 2) setWon = true;
    }

    if (setWon) {
      set.wonBy = winnerP;
      if (winnerP === 'player1') set.p1Games = Math.max(set.p1Games, set.p2Games + 1);
      else set.p2Games = Math.max(set.p2Games, set.p1Games + 1);
      s.inSetTiebreak = false;
      events.push(`${winnerP} wins the set tiebreak and the set!`);

      const setsWonP1 = s.sets.filter(x => x.wonBy === 'player1').length;
      const setsWonP2 = s.sets.filter(x => x.wonBy === 'player2').length;

      if (setsWonP1 === 2 || setsWonP2 === 2) {
        s.winner = setsWonP1 === 2 ? 'player1' : 'player2';
        events.push(`${s.winner} wins the match!`);
      } else if (setsWonP1 === 1 && setsWonP2 === 1 && decidingSet === 'match_tiebreak') {
        // Sets are 1-1: go straight to a 10-point match tiebreak, no 3rd set.
        s.inMatchTiebreak = true;
        s.matchTiebreak = { p1: 0, p2: 0, firstServer: other(tb.firstServer), target: 10, suddenDeath: false };
        events.push('Sets tied 1-1: playing a 10-point match tiebreak instead of a 3rd set.');
      } else {
        // Either only one set decided so far (e.g. 1-0), or sets are 1-1 but
        // this tournament plays a real 3rd (deciding) set instead of a tiebreak.
        s.currentSetIndex += 1;
        s.sets.push(freshSet());
        s.game = freshGame(other(tb.firstServer));
        events.push(setsWonP1 === 1 && setsWonP2 === 1 ? 'Sets tied 1-1: playing a 3rd (deciding) set.' : 'Starting the next set.');
      }
    }
    return { score: s, events, switchSuggestion };
  }

  // ---- 3. Normal game in progress ----
  const game = s.game;
  const key = winnerP === 'player1' ? 'p1Points' : 'p2Points';
  const otherKey = winnerP === 'player1' ? 'p2Points' : 'p1Points';
  game[key] += 1;

  const p1Label = pointLabel(game.p1Points, game.p2Points, noAd);
  const p2Label = pointLabel(game.p2Points, game.p1Points, noAd);
  events.push(`Point to ${winnerP}: ${p1Label}-${p2Label}`);

  let gameWon = false;
  if (noAd) {
    // No-Ad: first to 4 points wins outright, deuce (40-40) is sudden death.
    if (game[key] >= 4) gameWon = true;
  } else {
    // Ad scoring: must reach >=4 and be ahead by >=2.
    if (game[key] >= 4 && (game[key] - game[otherKey]) >= 2) gameWon = true;
  }

  if (!gameWon) {
    return { score: s, events, switchSuggestion };
  }

  // Game won -> update games count in current set
  const set = s.sets[s.currentSetIndex];
  if (winnerP === 'player1') set.p1Games += 1; else set.p2Games += 1;
  events.push(`${winnerP} wins the game. Games: ${set.p1Games}-${set.p2Games}`);

  const totalGamesInSet = set.p1Games + set.p2Games;
  // Switch-ends suggestion for normal games (not tiebreaks)
  if (phase === 1) {
    // Fast4: fixed to "odd_game" pacing per tournament decision - switch after
    // every odd total-games-count, quick water sip, no sit-down.
    if (totalGamesInSet % 2 === 1) {
      switchSuggestion = 'Switch ends now - quick sip of water (no sit-down).';
    } else if (switchPacing === 'every_two_games' && totalGamesInSet % 2 === 0 && totalGamesInSet > 0) {
      switchSuggestion = 'Switch ends now - 60s sit-down break.';
    }
  } else {
    if (totalGamesInSet % 2 === 1) {
      switchSuggestion = totalGamesInSet === 1
        ? 'Switch ends now - no sit-down (first game of the set).'
        : 'Switch ends now - 90s sit-down break.';
    }
  }

  // New game: server alternates
  s.game = freshGame(other(game.server));

  // ---- Set completion check ----
  const target = phase === 1 ? 4 : 6;
  let setDecided = false;

  if (phase === 1) {
    if (set.p1Games === 4 || set.p2Games === 4) {
      set.wonBy = set.p1Games === 4 ? 'player1' : 'player2';
      setDecided = true;
    } else if (set.p1Games === 3 && set.p2Games === 3) {
      s.inSetTiebreak = true;
      set.tiebreak = { p1: 0, p2: 0, firstServer: s.game.server, target: 5, suddenDeath: true };
      events.push('Set reaches 3-3: playing a 5-point sudden-death set tiebreak.');
    }
  } else {
    if (set.p1Games >= 6 && (set.p1Games - set.p2Games) >= 2) {
      set.wonBy = 'player1'; setDecided = true;
    } else if (set.p2Games >= 6 && (set.p2Games - set.p1Games) >= 2) {
      set.wonBy = 'player2'; setDecided = true;
    } else if (set.p1Games === 6 && set.p2Games === 6) {
      s.inSetTiebreak = true;
      set.tiebreak = { p1: 0, p2: 0, firstServer: s.game.server, target: 7, suddenDeath: false };
      events.push('Set reaches 6-6: playing a standard 7-point set tiebreak.');
    }
  }

  if (setDecided) {
    events.push(`${set.wonBy} wins the set ${set.p1Games}-${set.p2Games}!`);
    const setsWonP1 = s.sets.filter(x => x.wonBy === 'player1').length;
    const setsWonP2 = s.sets.filter(x => x.wonBy === 'player2').length;

    if (setsWonP1 === 2 || setsWonP2 === 2) {
      s.winner = setsWonP1 === 2 ? 'player1' : 'player2';
      events.push(`${s.winner} wins the match!`);
    } else if (setsWonP1 === 1 && setsWonP2 === 1 && decidingSet === 'match_tiebreak') {
      s.inMatchTiebreak = true;
      s.matchTiebreak = { p1: 0, p2: 0, firstServer: s.game.server, target: 10, suddenDeath: false };
      events.push('Sets tied 1-1: playing a 10-point match tiebreak instead of a 3rd set.');
    } else {
      // Start next set (either 1-0 so far, or 1-1 with a real 3rd set in play)
      s.currentSetIndex += 1;
      s.sets.push(freshSet());
      if (setsWonP1 === 1 && setsWonP2 === 1) events.push('Sets tied 1-1: playing a 3rd (deciding) set.');
    }
  }

  return { score: s, events, switchSuggestion };
}

module.exports = {
  newMatchScore,
  addPoint,
  pointLabel,
  tiebreakServerForPoint,
  isTiebreakSwitchPoint,
  other
};
