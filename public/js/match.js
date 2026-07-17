const params = new URLSearchParams(location.search);
const matchNumber = Number(params.get('m'));
document.getElementById('mNum').textContent = matchNumber;

let match = null;
let isAdmin = false;
let socket = null;
let lockHeartbeat = null;
let tossState = { tossWinner: null, winnerChoice: null, deferPick: null };

const other = p => p === 'player1' ? 'player2' : 'player1';

function pointLabel(count, otherCount, noAd) {
  const labels = ['0', '15', '30', '40'];
  if (count < 3 && otherCount < 3) return labels[count];
  if (count < 3) return labels[count];
  if (otherCount < 3) return '40';
  if (count === otherCount) return 'Deuce';
  if (noAd) return '40';
  return count > otherCount ? 'Ad' : '40';
}

// Mirrors utils/rulesEngine.js tiebreakServerForPoint: point 1 served by firstServer,
// then alternates in blocks of 2 (i.e. switches after point 1, then every 2 points).
function tiebreakServerForPoint(pointNumber, firstServer) {
  if (pointNumber <= 1) return firstServer;
  const idx = pointNumber - 2;
  const group = Math.floor(idx / 2);
  const serverIsFirst = group % 2 === 1;
  return serverIsFirst ? firstServer : other(firstServer);
}

async function checkAuth() {
  try {
    await Api.get('/api/auth/me');
    isAdmin = true;
  } catch (e) {
    isAdmin = false;
  }
  document.getElementById('authArea').innerHTML = isAdmin
    ? '<span class="small-note">Admin session active</span>'
    : '<span class="small-note">Viewing as spectator</span>';
}

async function loadMatch() {
  const data = await Api.get(`/api/matches/${matchNumber}`);
  match = data;
  render();
}

function connectSocket() {
  socket = io();
  socket.emit('join:match', matchNumber);
  socket.on('match:update', (updated) => {
    if (updated.matchNumber === matchNumber) {
      match = updated;
      render();
    }
  });
}

async function acquireLockIfAdmin() {
  if (!isAdmin) return;
  try {
    await Api.post(`/api/matches/${matchNumber}/lock`);
    document.getElementById('lockNotice').textContent = '';
    document.getElementById('adminControls').style.display = match.status === 'in_progress' || match.status === 'completed' ? 'block' : 'none';
    lockHeartbeat = setInterval(() => {
      Api.post(`/api/matches/${matchNumber}/lock/refresh`).catch(() => {});
    }, 60000);
  } catch (e) {
    document.getElementById('lockNotice').textContent = e.message;
  }
}

window.addEventListener('beforeunload', () => {
  if (isAdmin) {
    navigator.sendBeacon && navigator.sendBeacon(`/api/matches/${matchNumber}/lock`, '');
  }
});

// ---- Schedule view/edit ----

function renderSchedule() {
  const view = document.getElementById('scheduleView');
  view.innerHTML = `
    <div class="match-meta">${match.round} - ${match.session} - ${match.scheduledStart} to ${match.scheduledEnd}</div>
    <div class="match-players">${match.player1.name} vs ${match.player2.name}</div>
    <div class="small-note">Phase ${match.phase === 1 ? '1 (Fast4)' : '2 (Regular)'} · Switch pacing: ${match.switchPacing.replace('_', ' ')}</div>
    ${isAdmin ? '<button class="secondary" onclick="toggleScheduleEdit()">Edit</button>' : ''}
  `;

  const edit = document.getElementById('scheduleEdit');
  edit.innerHTML = `
    <div class="field-row"><label>Player 1</label><input id="p1NameInput" value="${match.player1.name}"></div>
    <div class="field-row"><label>Player 2</label><input id="p2NameInput" value="${match.player2.name}"></div>
    <div class="field-row"><label>Start time</label><input id="startInput" value="${match.scheduledStart}"></div>
    <div class="field-row"><label>End time</label><input id="endInput" value="${match.scheduledEnd}"></div>
    ${match.phase === 1 ? `
    <div class="field-row"><label>Fast4 pacing</label>
      <select id="pacingInput">
        <option value="odd_game" ${match.switchPacing === 'odd_game' ? 'selected' : ''}>Odd game (water sip, no sit)</option>
        <option value="every_two_games" ${match.switchPacing === 'every_two_games' ? 'selected' : ''}>Every 2 games (60s sit-down)</option>
      </select>
    </div>` : ''}
    <button onclick="saveSchedule()">Save</button>
    <button class="secondary" onclick="toggleScheduleEdit()">Cancel</button>
    <div id="scheduleError" class="error-msg"></div>
  `;
}

function toggleScheduleEdit() {
  const edit = document.getElementById('scheduleEdit');
  edit.style.display = edit.style.display === 'none' ? 'block' : 'none';
}

async function saveSchedule() {
  try {
    const body = {
      player1Name: document.getElementById('p1NameInput').value,
      player2Name: document.getElementById('p2NameInput').value,
      scheduledStart: document.getElementById('startInput').value,
      scheduledEnd: document.getElementById('endInput').value,
      expectedVersion: match.version
    };
    const pacingEl = document.getElementById('pacingInput');
    if (pacingEl) body.switchPacing = pacingEl.value;
    const res = await Api.patch(`/api/matches/${matchNumber}/schedule`, body);
    match = res.match;
    toggleScheduleEdit();
    render();
  } catch (e) {
    document.getElementById('scheduleError').textContent = e.message;
  }
}

// ---- Coin toss ----

function renderToss() {
  const view = document.getElementById('tossView');
  const form = document.getElementById('tossForm');

  if (match.coinToss && match.coinToss.recordedAt) {
    const ct = match.coinToss;
    view.innerHTML = `
      <div>Toss winner: <b>${match[ct.tossWinner].name}</b> chose to <b>${ct.winnerChoice}</b>${ct.winnerChoice === 'defer' ? ' (passed first choice to opponent)' : ''}.</div>
      <div>${match[ct.serveChoice.player].name} will <b>${ct.serveChoice.decision}</b> first.</div>
      <div>${match[ct.sideChoice.player].name} starts on the <b>${ct.sideChoice.side}</b>.</div>
      ${isAdmin && match.status === 'toss_done' ? '<button onclick="toggleTossForm()">Re-record toss</button>' : ''}
    `;
  } else {
    view.innerHTML = '<span class="small-note">Not recorded yet.</span>';
  }

  if (isAdmin && (match.status === 'scheduled' || match.status === 'toss_done')) {
    form.style.display = match.status === 'scheduled' ? 'block' : 'none';
    renderTossForm();
  } else {
    form.style.display = 'none';
  }
}

function toggleTossForm() {
  const form = document.getElementById('tossForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  renderTossForm();
}

function renderTossForm() {
  const form = document.getElementById('tossForm');
  const p1 = match.player1.name, p2 = match.player2.name;

  let html = `
    <div class="field-row"><label>Toss winner</label>
      <select id="tossWinnerSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="player1" ${tossState.tossWinner === 'player1' ? 'selected' : ''}>${p1}</option>
        <option value="player2" ${tossState.tossWinner === 'player2' ? 'selected' : ''}>${p2}</option>
      </select>
    </div>`;

  if (tossState.tossWinner) {
    html += `
    <div class="field-row"><label>Winner's choice</label>
      <select id="winnerChoiceSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.winnerChoice === 'serve' ? 'selected' : ''}>To Serve or Receive</option>
        <option value="side" ${tossState.winnerChoice === 'side' ? 'selected' : ''}>The Starting Side</option>
        <option value="defer" ${tossState.winnerChoice === 'defer' ? 'selected' : ''}>Defer to opponent</option>
      </select>
    </div>`;
  }

  let chooser = tossState.tossWinner;
  let pick = tossState.winnerChoice;

  if (tossState.winnerChoice === 'defer' && tossState.tossWinner) {
    chooser = other(tossState.tossWinner);
    html += `
    <div class="field-row"><label>${match[chooser].name} chooses</label>
      <select id="deferPickSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.deferPick === 'serve' ? 'selected' : ''}>To Serve or Receive</option>
        <option value="side" ${tossState.deferPick === 'side' ? 'selected' : ''}>The Starting Side</option>
      </select>
    </div>`;
    pick = tossState.deferPick;
  }

  if (pick === 'serve' && chooser) {
    const sideChooser = other(chooser);
    html += `
    <div class="field-row"><label>${match[chooser].name} decides</label>
      <select id="serveDecisionSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.serveDecision === 'serve' ? 'selected' : ''}>Serve first</option>
        <option value="receive" ${tossState.serveDecision === 'receive' ? 'selected' : ''}>Receive first</option>
      </select>
    </div>
    <div class="field-row"><label>${match[sideChooser].name} picks side</label>
      <select id="sideSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="pool-end" ${tossState.side === 'pool-end' ? 'selected' : ''}>Pool End</option>
        <option value="entrance-end" ${tossState.side === 'entrance-end' ? 'selected' : ''}>Entrance End</option>
      </select>
    </div>`;
  } else if (pick === 'side' && chooser) {
    const serveChooser = other(chooser);
    html += `
    <div class="field-row"><label>${match[chooser].name} picks side</label>
      <select id="sideSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="pool-end" ${tossState.side === 'pool-end' ? 'selected' : ''}>Pool End</option>
        <option value="entrance-end" ${tossState.side === 'entrance-end' ? 'selected' : ''}>Entrance End</option>
      </select>
    </div>
    <div class="field-row"><label>${match[serveChooser].name} decides</label>
      <select id="serveDecisionSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.serveDecision === 'serve' ? 'selected' : ''}>Serve first</option>
        <option value="receive" ${tossState.serveDecision === 'receive' ? 'selected' : ''}>Receive first</option>
      </select>
    </div>`;
  }

  const ready = tossState.tossWinner && tossState.winnerChoice &&
    (tossState.winnerChoice !== 'defer' || tossState.deferPick) &&
    tossState.serveDecision && tossState.side;

  html += `<button ${ready ? '' : 'disabled'} onclick="saveToss()">Save Coin Toss</button>
    <div id="tossError" class="error-msg"></div>`;

  form.innerHTML = html;
}

function updateToss() {
  const g = id => document.getElementById(id);
  if (g('tossWinnerSel')) tossState.tossWinner = g('tossWinnerSel').value || null;
  if (g('winnerChoiceSel')) tossState.winnerChoice = g('winnerChoiceSel').value || null;
  if (g('deferPickSel')) tossState.deferPick = g('deferPickSel').value || null;
  if (g('serveDecisionSel')) tossState.serveDecision = g('serveDecisionSel').value || null;
  if (g('sideSel')) tossState.side = g('sideSel').value || null;
  renderTossForm();
}

async function saveToss() {
  const chooser = tossState.winnerChoice === 'defer' ? other(tossState.tossWinner) : tossState.tossWinner;
  const pick = tossState.winnerChoice === 'defer' ? tossState.deferPick : tossState.winnerChoice;
  const serveChoicePlayer = pick === 'serve' ? chooser : other(chooser);
  const sideChoicePlayer = pick === 'side' ? chooser : other(chooser);

  try {
    const res = await Api.post(`/api/matches/${matchNumber}/toss`, {
      tossWinner: tossState.tossWinner,
      winnerChoice: tossState.winnerChoice,
      serveChoicePlayer,
      serveDecision: tossState.serveDecision,
      sideChoicePlayer,
      side: tossState.side,
      expectedVersion: match.version
    });
    match = res.match;
    render();
  } catch (e) {
    document.getElementById('tossError').textContent = e.message;
  }
}

// ---- Scoreboard ----

function setLabel(set, idx) {
  let label = `Set${idx + 1}: ${set.p1Games}-${set.p2Games}`;
  if (set.tiebreak && set.wonBy) {
    label += ` (TB: ${set.tiebreak.p1}-${set.tiebreak.p2})`;
  }
  return label;
}

function buildSetsSummary(s) {
  const parts = s.sets.map((set, idx) => setLabel(set, idx));
  if (s.matchTiebreak) {
    parts.push(`Match Tiebreak: ${s.matchTiebreak.p1}-${s.matchTiebreak.p2}`);
  }
  return parts.join(' | ');
}

function renderScoreboard() {
  const board = document.getElementById('scoreboard');
  if (match.status === 'scheduled') {
    board.style.display = 'none';
    return;
  }
  board.style.display = 'block';
  const s = match.score;
  const setsStr = buildSetsSummary(s);

  let pointsStr = '';
  let serverName = '';
  if (s.inMatchTiebreak && s.matchTiebreak) {
    const tb = s.matchTiebreak;
    pointsStr = `${tb.p1} - ${tb.p2} (10-Point Match Tiebreak)`;
    const server = tiebreakServerForPoint(tb.p1 + tb.p2 + 1, tb.firstServer);
    serverName = `${match[server].name} serving`;
  } else if (s.inSetTiebreak && s.sets[s.currentSetIndex].tiebreak) {
    const tb = s.sets[s.currentSetIndex].tiebreak;
    pointsStr = `${tb.p1} - ${tb.p2} (${tb.target}-Point Set Tiebreak)`;
    const server = tiebreakServerForPoint(tb.p1 + tb.p2 + 1, tb.firstServer);
    serverName = `${match[server].name} serving`;
  } else {
    const noAd = match.phase === 1;
    pointsStr = `${pointLabel(s.game.p1Points, s.game.p2Points, noAd)} - ${pointLabel(s.game.p2Points, s.game.p1Points, noAd)}`;
    serverName = s.game.server ? `${match[s.game.server].name} serving` : '';
  }

  board.innerHTML = `
    <div class="names">${match.player1.name} vs ${match.player2.name}</div>
    <div class="sets">${setsStr}</div>
    <div class="points">${pointsStr}</div>
    ${serverName ? `<div class="server-tag">${serverName}</div>` : ''}
    ${s.winner ? `<div class="server-tag">Winner: ${match[s.winner].name} 🏆</div>` : ''}
  `;
}

// ---- Admin scoring controls ----

function renderAdminControls() {
  const controls = document.getElementById('adminControls');
  const startBtn = document.getElementById('startBtn');
  const finishBtn = document.getElementById('finishBtn');
  if (!isAdmin) { controls.style.display = 'none'; return; }

  document.getElementById('p1NameBtn').textContent = match.player1.name;
  document.getElementById('p2NameBtn').textContent = match.player2.name;

  if (match.status === 'toss_done') {
    controls.style.display = 'block';
    startBtn.style.display = 'inline-block';
    finishBtn.style.display = 'none';
    document.querySelectorAll('.point-buttons button').forEach(b => b.disabled = true);
  } else if (match.status === 'in_progress') {
    controls.style.display = 'block';
    startBtn.style.display = 'none';
    finishBtn.style.display = 'inline-block';
    document.querySelectorAll('.point-buttons button').forEach(b => b.disabled = false);
  } else if (match.status === 'completed') {
    controls.style.display = 'block';
    startBtn.style.display = 'none';
    finishBtn.style.display = 'none';
    document.querySelectorAll('.point-buttons button').forEach(b => b.disabled = true);
  } else {
    controls.style.display = 'none';
  }
}

function openFinishPanel() {
  document.getElementById('finishPanel').style.display = 'block';
  const row = document.getElementById('finishWinnerRow');
  if (!match.score.winner) {
    row.style.display = 'flex';
    document.querySelector('#finishWinnerSel option[value="player1"]').textContent = match.player1.name;
    document.querySelector('#finishWinnerSel option[value="player2"]').textContent = match.player2.name;
  } else {
    row.style.display = 'none';
  }
  document.getElementById('finishError').textContent = '';
}

function closeFinishPanel() {
  document.getElementById('finishPanel').style.display = 'none';
}

async function confirmFinish() {
  try {
    const body = { expectedVersion: match.version };
    if (!match.score.winner) {
      body.winner = document.getElementById('finishWinnerSel').value;
    }
    const res = await Api.post(`/api/matches/${matchNumber}/finish`, body);
    match = res.match;
    closeFinishPanel();
    logEvent('Match marked as finished.');
    render();
  } catch (e) {
    document.getElementById('finishError').textContent = e.message;
  }
}

async function startMatch() {
  try {
    const res = await Api.post(`/api/matches/${matchNumber}/start`);
    match = res.match;
    render();
  } catch (e) {
    logEvent('Error: ' + e.message);
  }
}

async function addPoint(scorer) {
  try {
    const res = await Api.post(`/api/matches/${matchNumber}/point`, { scorer, expectedVersion: match.version });
    match = res.match;
    (res.events || []).forEach(logEvent);
    const banner = document.getElementById('switchBanner');
    if (res.switchSuggestion) {
      banner.style.display = 'block';
      banner.textContent = res.switchSuggestion;
    } else {
      banner.style.display = 'none';
    }
    render();
  } catch (e) {
    logEvent('Error: ' + e.message);
  }
}

async function undoPoint() {
  try {
    const res = await Api.post(`/api/matches/${matchNumber}/undo`);
    match = res.match;
    logEvent('Last point undone.');
    document.getElementById('switchBanner').style.display = 'none';
    render();
  } catch (e) {
    logEvent('Error: ' + e.message);
  }
}

function logEvent(text) {
  const log = document.getElementById('eventLog');
  const div = document.createElement('div');
  div.textContent = text;
  log.prepend(div);
}

// ---- Master render ----

function render() {
  renderSchedule();
  renderToss();
  renderScoreboard();
  renderAdminControls();
}

(async function init() {
  await checkAuth();
  await loadMatch();
  connectSocket();
  await acquireLockIfAdmin();
})();
