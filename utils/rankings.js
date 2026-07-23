/**
 * Computes end-of-tournament rankings from a list of completed match documents
 * (plain objects, e.g. from Match.find().lean()).
 *
 * Ranking rule:
 *   1. Furthest round reached (Champion > Runner-up > Semifinalist > Quarterfinalist
 *      > Round of 16 > Play-In), determined from the highest-round match each
 *      player appears in.
 *   2. Tiebreak within the same round: game differential (games won - games lost)
 *      across all their matches in the tournament, then total games won.
 *   3. True ties (identical round + identical diff + identical games won) share
 *      the same rank number and are flagged with a note.
 */

const ROUND_ORDER = ['Play-In', 'Round of 16', 'Quarterfinal', 'Semifinal', 'Final'];

function roundRank(roundName) {
  const idx = ROUND_ORDER.indexOf(roundName);
  return idx === -1 ? 0 : idx;
}

function statusLabel(roundName, isChampion) {
  if (isChampion) return 'Champion';
  switch (roundName) {
    case 'Final': return 'Runner-up';
    case 'Semifinal': return 'Semifinalist';
    case 'Quarterfinal': return 'Quarterfinalist';
    case 'Round of 16': return 'Round of 16';
    case 'Play-In': return 'Play-In';
    default: return roundName;
  }
}

function computeRankings(matches) {
  const completed = matches.filter(m => m.status === 'completed' && m.score && m.score.winner);
  const stats = {}; // playerName -> { bestRoundRank, bestRoundName, wonBestRound, gamesWon, gamesLost }

  function ensure(name) {
    if (!stats[name]) {
      stats[name] = { bestRoundRank: -1, bestRoundName: null, wonBestRound: false, gamesWon: 0, gamesLost: 0 };
    }
    return stats[name];
  }

  for (const m of completed) {
    const p1Name = m.player1.name;
    const p2Name = m.player2.name;
    const rRank = roundRank(m.round);
    const winnerName = m.score.winner === 'player1' ? p1Name : p2Name;

    // Tally games won/lost from the recorded sets (match-tiebreak points aren't
    // counted as "games" since they replace a 3rd set rather than being one).
    let p1Games = 0, p2Games = 0;
    for (const set of (m.score.sets || [])) {
      p1Games += set.p1Games || 0;
      p2Games += set.p2Games || 0;
    }

    const s1 = ensure(p1Name);
    s1.gamesWon += p1Games;
    s1.gamesLost += p2Games;
    if (rRank > s1.bestRoundRank) {
      s1.bestRoundRank = rRank;
      s1.bestRoundName = m.round;
      s1.wonBestRound = winnerName === p1Name;
    } else if (rRank === s1.bestRoundRank && winnerName === p1Name) {
      s1.wonBestRound = true;
    }

    const s2 = ensure(p2Name);
    s2.gamesWon += p2Games;
    s2.gamesLost += p1Games;
    if (rRank > s2.bestRoundRank) {
      s2.bestRoundRank = rRank;
      s2.bestRoundName = m.round;
      s2.wonBestRound = winnerName === p2Name;
    } else if (rRank === s2.bestRoundRank && winnerName === p2Name) {
      s2.wonBestRound = true;
    }
  }

  const players = Object.keys(stats).map(name => {
    const s = stats[name];
    const isChampion = s.bestRoundName === 'Final' && s.wonBestRound;
    return {
      playerName: name,
      furthestRound: statusLabel(s.bestRoundName, isChampion),
      sortRoundRank: s.bestRoundRank + (isChampion ? 1 : 0), // champion ranks above runner-up
      gamesWon: s.gamesWon,
      gamesLost: s.gamesLost,
      gameDiff: s.gamesWon - s.gamesLost
    };
  });

  players.sort((a, b) => {
    if (b.sortRoundRank !== a.sortRoundRank) return b.sortRoundRank - a.sortRoundRank;
    if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
    return b.gamesWon - a.gamesWon;
  });

  const entries = [];
  let rank = 0;
  let prevKey = null;
  players.forEach((p, idx) => {
    const key = `${p.sortRoundRank}|${p.gameDiff}|${p.gamesWon}`;
    if (key !== prevKey) rank = idx + 1;
    prevKey = key;
    entries.push({
      rank,
      playerName: p.playerName,
      furthestRound: p.furthestRound,
      gamesWon: p.gamesWon,
      gamesLost: p.gamesLost,
      gameDiff: p.gameDiff,
      note: ''
    });
  });

  // Flag genuine ties (same rank shared by 2+ players) for visibility.
  const rankCounts = {};
  entries.forEach(e => { rankCounts[e.rank] = (rankCounts[e.rank] || 0) + 1; });
  entries.forEach(e => {
    if (rankCounts[e.rank] > 1) e.note = `Tied (${rankCounts[e.rank]}-way) on round reached and game differential`;
  });

  return entries;
}

module.exports = { computeRankings, ROUND_ORDER, roundRank };
