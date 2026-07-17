const { newMatchScore, addPoint } = require('./utils/rulesEngine');

function play(phase, sequence, pacing = 'odd_game') {
  let score = newMatchScore('player1');
  let log = [];
  for (const scorer of sequence) {
    const r = addPoint(score, phase, scorer, pacing);
    score = r.score;
    if (r.switchSuggestion) log.push('SWITCH: ' + r.switchSuggestion);
    log.push(...r.events);
  }
  return { score, log };
}

function winGame(winner) { return [winner, winner, winner, winner]; }

let failures = 0;
function check(name, cond) {
  if (!cond) { console.log('FAIL:', name); failures++; }
  else console.log('PASS:', name);
}

// Test 1: Fast4 set won 4-0
let seq = [];
for (let g = 0; g < 4; g++) seq.push(...winGame('player1'));
let { score } = play(1, seq);
check('Fast4 4-0 set', score.sets[0].p1Games === 4 && score.sets[0].wonBy === 'player1');

// Test 2: No-Ad deuce sudden death
seq = ['player1', 'player1', 'player1', 'player2', 'player2', 'player2', 'player2'];
let r2 = play(1, seq);
check('No-Ad deuce sudden point goes to scorer', r2.score.sets[0].p2Games === 1);

// Test 3: Fast4 3-3 -> 5pt sudden death tiebreak, win 5-4
seq = [];
seq.push(...winGame('player1'));
seq.push(...winGame('player2'));
seq.push(...winGame('player1'));
seq.push(...winGame('player2'));
seq.push(...winGame('player1'));
seq.push(...winGame('player2')); // 3-3
seq.push('player1', 'player2', 'player1', 'player2', 'player1', 'player2', 'player1', 'player2', 'player1'); // 4-4 then p1 wins
let r3 = play(1, seq);
check('Fast4 5pt tiebreak sudden death at 4-4, recorded as 4-3(tb)',
  r3.score.sets[0].wonBy === 'player1' && r3.score.sets[0].p1Games === 4 && r3.score.sets[0].p2Games === 3 &&
  r3.score.sets[0].tiebreak.p1 === 5 && r3.score.sets[0].tiebreak.p2 === 4);

// Test 4: Sets split 1-1 -> 10pt match tiebreak, win by 2
seq = [];
for (let g = 0; g < 4; g++) seq.push(...winGame('player1')); // set1 p1 4-0
for (let g = 0; g < 4; g++) seq.push(...winGame('player2')); // set2 p2 4-0
let r4setup = play(1, seq);
check('Sets 1-1 triggers match tiebreak', r4setup.score.inMatchTiebreak === true);

let tbSeq = [];
for (let i = 0; i < 8; i++) tbSeq.push(i % 2 === 0 ? 'player2' : 'player1'); // 4-4
tbSeq.push('player2', 'player2'); // 6-4
tbSeq.push('player1', 'player1', 'player1', 'player1'); // 6-8
tbSeq.push('player2', 'player2'); // 8-8
tbSeq.push('player2', 'player2'); // 10-8 win by 2
let r4 = play(1, seq.concat(tbSeq));
check('Match tiebreak 10-8 win by 2', r4.score.winner === 'player2' &&
  r4.score.matchTiebreak.p1 === 8 && r4.score.matchTiebreak.p2 === 10);

// Test 5: Regular ad-scoring deuce/advantage
seq = ['player1', 'player1', 'player1', 'player2', 'player2', 'player2']; // 40-40
seq.push('player1'); // Ad player1
let r5a = play(2, seq);
check('Ad point makes it 4-3 (not game won yet)', r5a.score.game.p1Points === 4 && r5a.score.game.p2Points === 3 && r5a.score.sets[0].p1Games === 0);
seq.push('player2'); // back to deuce (4-4)
let r5b = play(2, seq);
check('Back to deuce at 4-4', r5b.score.game.p1Points === 4 && r5b.score.game.p2Points === 4);
seq.push('player1', 'player1'); // wins by 2
let r5c = play(2, seq);
check('Regular game won via ad after multiple deuces', r5c.score.sets[0].p1Games === 1);

// Test 6: Regular set 6-6 -> 7pt tiebreak, win 8-6
seq = [];
for (let i = 0; i < 6; i++) { seq.push(...winGame('player1')); seq.push(...winGame('player2')); }
let r6setup = play(2, seq);
check('Regular set 6-6 triggers 7pt tiebreak', r6setup.score.inSetTiebreak === true && r6setup.score.sets[0].tiebreak.target === 7);

let seqFull = seq.concat(['player1', 'player2', 'player1', 'player2', 'player1', 'player2', 'player1', 'player2', 'player1', 'player2', 'player1', 'player2', 'player1', 'player1']);
let r6 = play(2, seqFull);
check('7pt tiebreak resolves, set recorded 7-6(tb) to player1', r6.score.sets[0].wonBy === 'player1' && r6.score.sets[0].p1Games === 7 && r6.score.sets[0].p2Games === 6 &&
  r6.score.sets[0].tiebreak.p1 === 8 && r6.score.sets[0].tiebreak.p2 === 6);

// Test 7: Switch-ends suggestion fires after odd games in Fast4 (water sip)
seq = [...winGame('player1')]; // 1 game played -> total games=1 (odd)
let r7 = play(1, seq);
check('Switch suggestion after odd game (Fast4)', r7.log.some(l => l.includes('SWITCH') && l.includes('sip of water')));

// Test 8: Regular - no sit down after first game of set, sit-down after 3rd
seq = [...winGame('player1')];
let r8a = play(2, seq);
check('Regular: no sit-down after game 1', r8a.log.some(l => l.includes('SWITCH') && l.includes('no sit-down')));

seq = [...winGame('player1'), ...winGame('player2'), ...winGame('player1')]; // 3 games total (odd)
let r8b = play(2, seq);
check('Regular: 90s sit-down after game 3', r8b.log.some(l => l.includes('SWITCH') && l.includes('90s')));

// Test 9 (regression): Set 1 decided via tiebreak (1-0) should start Set 2, NOT jump to match tiebreak
seq = [];
seq.push(...winGame('player1'));
seq.push(...winGame('player2'));
seq.push(...winGame('player1'));
seq.push(...winGame('player2'));
seq.push(...winGame('player1'));
seq.push(...winGame('player2')); // 3-3 -> tiebreak
seq.push('player1', 'player1', 'player1', 'player1', 'player1'); // player1 wins breaker 5-0, set 1 done 1-0
let r9 = play(1, seq);
check('Set 1 won via tiebreak (1-0) starts Set 2, no premature match tiebreak',
  r9.score.sets.length === 2 && r9.score.currentSetIndex === 1 &&
  r9.score.inMatchTiebreak === false && r9.score.winner === null &&
  r9.score.sets[0].wonBy === 'player1');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
