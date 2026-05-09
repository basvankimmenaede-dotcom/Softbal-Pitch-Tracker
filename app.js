// OG Pitching Tracker

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby_SD7MDqIzOD8FIrpjh-XwaqMlz5epHVMt88upepu1x96ss8B0LXWSYbzZ-F8yrH6W/exec";

const pitchTypeOptions = ["Fastball", "Slowball", "Overig"];
const resultOptions = ["Ball", "Strike", "Swing", "Foul", "HIT", "Out"];

let game = {
  opponent: "",
  pitcherName: "",
  date: "",
  startTime: "",
  lineup: [],
  batterIndex: 0,
  balls: 0,
  strikes: 0,
  totalBalls: 0,
  totalStrikes: 0,
  firstPitchStrikes: 0,
  outs: 0,
  totalOuts: 0,
  pitchLocation: null,
  pitchType: "Fastball",
  result: "Ball",
  pitches: [],
  appsScriptUrl: APPS_SCRIPT_URL,
  gameId: "",
  closed: false,
  startedAt: ""
};

function init() {
  const dateInput = document.getElementById("gameDate");
  const timeInput = document.getElementById("gameTime");

  if (dateInput) dateInput.valueAsDate = new Date();
  if (timeInput) timeInput.value = new Date().toTimeString().slice(0, 5);

  renderLineupRows();
  renderChoices("pitchTypes", pitchTypeOptions, "pitchType");
  renderChoices("results", resultOptions, "result");
}

function setActiveScreen(screenId) {
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function showHome() {
  setActiveScreen("homeScreen");
}

function showSetup() {
  prepareNewGameForm();
  setActiveScreen("setupScreen");
}

function prepareNewGameForm() {
  document.getElementById("opponent").value = "";
  document.getElementById("pitcherName").value = "";
  document.getElementById("gameDate").valueAsDate = new Date();
  document.getElementById("gameTime").value = new Date().toTimeString().slice(0, 5);

  for (let i = 1; i <= 9; i++) {
    const name = document.getElementById(`name${i}`);
    const num = document.getElementById(`num${i}`);
    if (name) name.value = "";
    if (num) num.value = "";
  }

  setSyncStatus("Google Sheets nog niet getest.");
}

function showPlaceholder(title) {
  document.getElementById("placeholderTitle").textContent = title;
  setActiveScreen("placeholderScreen");
}

function showPitcherStats() {
  setActiveScreen("pitcherStatsScreen");
  renderPitcherStats();
}

function getPitcherGames(pitcherName) {
  return getStoredGames().filter(g => g.pitcherName === pitcherName);
}

function calculateGameStats(g) {
  const pitches = g.pitches || [];
  const totalPitches = pitches.length;

  const strikes = pitches.filter(p =>
    ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)
  ).length;

  const balls = pitches.filter(p => p.result === "Ball").length;
  const outs = Number(g.totalOuts || 0);

  const fps = pitches.filter(p =>
    p.firstPitch && ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)
  ).length;

  const totalBatters = countTotalBatters(g);
  const walks = countWalks(g);
  const sbRatio = balls === 0 ? strikes.toFixed(2) : (strikes / balls).toFixed(2);

  return {
    totalPitches,
    strikes,
    balls,
    outs,
    ip: formatInningsPitched(outs),
    fps,
    totalBatters,
    walks,
    sbRatio
  };
}

function countTotalBatters(g) {
  const pitches = g.pitches || [];
  return pitches.filter(p => p.firstPitch).length;
}

function countWalks(g) {
  const pitches = (g.pitches || []).slice().reverse();
  let balls = 0;
  let strikes = 0;
  let walks = 0;

  pitches.forEach(p => {
    if (p.firstPitch) {
      balls = 0;
      strikes = 0;
    }

    if (p.result === "Ball") balls += 1;
    if (["Strike", "Swing"].includes(p.result)) strikes += 1;
    if (p.result === "Foul" && strikes < 2) strikes += 1;

    if (p.walk || balls >= 4) {
      walks += 1;
      balls = 0;
      strikes = 0;
    }

    if (["HIT", "Out"].includes(p.result) || strikes >= 3) {
      balls = 0;
      strikes = 0;
    }
  });

  return walks;
}

function renderPitcherStats() {
  const select = document.getElementById("statsPitcherName");
  if (!select) return;

  const pitcherName = select.value;
  const body = document.getElementById("statsPerGameBody");

  if (!pitcherName) {
    document.getElementById("statsTotalPitches").textContent = "0";
    document.getElementById("statsTotalStrikes").textContent = "0";
    document.getElementById("statsTotalBalls").textContent = "0";
    document.getElementById("statsTotalOuts").textContent = "0";
    document.getElementById("statsTotalIP").textContent = "0.000";
    document.getElementById("statsTotalFPS").textContent = "0";
    document.getElementById("statsSBRatio").textContent = "0.00";
    document.getElementById("statsWalks").textContent = "0";
    document.getElementById("statsFPSBatters").textContent = "0/0";
    body.innerHTML = `<tr><td colspan="11">Kies een pitcher.</td></tr>`;
    return;
  }

  const games = getPitcherGames(pitcherName);

  if (!games.length) {
    document.getElementById("statsTotalPitches").textContent = "0";
    document.getElementById("statsTotalStrikes").textContent = "0";
    document.getElementById("statsTotalBalls").textContent = "0";
    document.getElementById("statsTotalOuts").textContent = "0";
    document.getElementById("statsTotalIP").textContent = "0.000";
    document.getElementById("statsTotalFPS").textContent = "0";
    document.getElementById("statsSBRatio").textContent = "0.00";
    document.getElementById("statsWalks").textContent = "0";
    document.getElementById("statsFPSBatters").textContent = "0/0";
    body.innerHTML = `<tr><td colspan="11">Geen games gevonden voor ${pitcherName}.</td></tr>`;
    return;
  }

  const totals = games.reduce((acc, g) => {
    const s = calculateGameStats(g);
    acc.totalPitches += s.totalPitches;
    acc.strikes += s.strikes;
    acc.balls += s.balls;
    acc.outs += s.outs;
    acc.fps += s.fps;
    acc.walks += s.walks;
    acc.totalBatters += s.totalBatters;
    return acc;
  }, { totalPitches: 0, strikes: 0, balls: 0, outs: 0, fps: 0, walks: 0, totalBatters: 0 });

  document.getElementById("statsTotalPitches").textContent = totals.totalPitches;
  document.getElementById("statsTotalStrikes").textContent = totals.strikes;
  document.getElementById("statsTotalBalls").textContent = totals.balls;
  document.getElementById("statsTotalOuts").textContent = totals.outs;
  document.getElementById("statsTotalIP").textContent = formatInningsPitched(totals.outs);
  document.getElementById("statsTotalFPS").textContent = totals.fps;
  document.getElementById("statsSBRatio").textContent = totals.balls === 0 ? totals.strikes.toFixed(2) : (totals.strikes / totals.balls).toFixed(2);
  document.getElementById("statsWalks").textContent = totals.walks;
  document.getElementById("statsFPSBatters").textContent = `${totals.fps}/${totals.totalBatters}`;

  body.innerHTML = games.map(g => {
    const s = calculateGameStats(g);
    return `
      <tr>
        <td>${g.date || "-"}</td>
        <td>${g.opponent || "-"}</td>
        <td>${s.totalPitches}</td>
        <td>${s.strikes}</td>
        <td>${s.balls}</td>
        <td>${s.outs}</td>
        <td>${s.ip}</td>
        <td>${s.fps}</td>
        <td>${s.sbRatio}</td>
        <td>${s.walks}</td>
        <td>${s.fps}/${s.totalBatters}</td>
      </tr>
    `;
  }).join("");
}



function showBatterSearch() {
  populateBatterOpponentFilter();
  setActiveScreen("batterSearchScreen");
  renderBatterSearch();
}

function populateBatterOpponentFilter() {
  const select = document.getElementById("batterSearchOpponent");
  if (!select) return;

  const opponents = [...new Set(getStoredGames().map(g => g.opponent).filter(Boolean))].sort();
  const current = select.value;

  select.innerHTML = `<option value="">Alle tegenstanders</option>` + opponents.map(o =>
    `<option value="${o}">${o}</option>`
  ).join("");

  if (opponents.includes(current)) select.value = current;
}

function getAllPitchesFromStoredGames() {
  return getStoredGames().flatMap(g => {
    const pitches = g.pitches || [];
    return pitches.map(p => ({
      ...p,
      gameDate: g.date || p.date || "",
      gameOpponent: g.opponent || p.opponent || "",
      gameId: g.gameId || ""
    }));
  });
}

function renderBatterSearch() {
  const input = document.getElementById("batterSearchInput");
  const opponentSelect = document.getElementById("batterSearchOpponent");
  if (!input) return;

  const query = input.value.trim().toLowerCase();
  const selectedOpponent = opponentSelect ? opponentSelect.value : "";
  const heatmap = document.getElementById("batterSearchHeatmap");
  const body = document.getElementById("batterSearchTableBody");

  if (heatmap) heatmap.querySelectorAll(".heat-dot").forEach(dot => dot.remove());

  if (!query) {
    document.getElementById("batterSearchPitches").textContent = "0";
    document.getElementById("batterSearchHits").textContent = "0";
    document.getElementById("batterSearchOuts").textContent = "0";
    document.getElementById("batterSearchBalls").textContent = "0";
    document.getElementById("batterSearchStrikes").textContent = "0";
    document.getElementById("batterSearchGames").textContent = "0";
    body.innerHTML = `<tr><td colspan="6">Kies tegenstander en zoek op naam of rugnummer.</td></tr>`;
    return;
  }

  let allPitches = getAllPitchesFromStoredGames();

  if (selectedOpponent) {
    allPitches = allPitches.filter(p => p.gameOpponent === selectedOpponent);
  }

  const matches = allPitches.filter(p => {
    const name = String(p.batterName || "").toLowerCase();
    const number = String(p.batterNumber || "").toLowerCase();
    return name.includes(query) || number.includes(query);
  });

  const hits = matches.filter(p => p.result === "HIT").length;
  const outs = matches.filter(p => p.result === "Out").length;
  const balls = matches.filter(p => p.result === "Ball").length;
  const strikes = matches.filter(p => ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)).length;
  const games = new Set(matches.map(p => p.gameId || `${p.gameDate}-${p.gameOpponent}`)).size;

  document.getElementById("batterSearchPitches").textContent = matches.length;
  document.getElementById("batterSearchHits").textContent = hits;
  document.getElementById("batterSearchOuts").textContent = outs;
  document.getElementById("batterSearchBalls").textContent = balls;
  document.getElementById("batterSearchStrikes").textContent = strikes;
  document.getElementById("batterSearchGames").textContent = matches.length ? games : 0;

  matches.forEach((p, index) => {
    if (!heatmap || p.x == null || p.y == null) return;

    const dot = document.createElement("div");
    dot.className = "heat-dot";
    if (p.result === "HIT") dot.classList.add("hit");
    if (p.result === "Out") dot.classList.add("out");
    dot.style.left = `${p.x}%`;
    dot.style.top = `${p.y}%`;
    dot.title = `${p.batterName} #${p.batterNumber} · ${p.pitcherName || "Pitcher onbekend"} · ${p.pitchType} · ${p.result} · ${getReadableZone(p)}`;
    dot.textContent = index + 1;
    heatmap.appendChild(dot);
  });

  if (!matches.length) {
    body.innerHTML = `<tr><td colspan="6">Geen pitches gevonden.</td></tr>`;
    return;
  }

  body.innerHTML = matches.slice().reverse().map(p => `
    <tr>
      <td>${p.gameDate || "-"}</td>
      <td>${p.gameOpponent || "-"}</td>
      <td>${p.pitcherName || "-"}</td>
      <td>${p.pitchType || "-"}</td>
      <td>${p.result || "-"}</td>
      <td>${getReadableZone(p)}</td>
    </tr>
  `).join("");
}

function getReadableZone(p) {
  if (p.zoneLabel) return p.zoneLabel;
  if (p.x != null && p.y != null) return getPitchZone(Number(p.x), Number(p.y)).label;
  return "-";
}

function continuePreviousGame() {
  showUnfinishedGames();
}

function getStoredGames() {
  try {
    return JSON.parse(localStorage.getItem("ogSoftbalGames") || "[]");
  } catch (error) {
    return [];
  }
}

function saveStoredGames(games) {
  localStorage.setItem("ogSoftbalGames", JSON.stringify(games));
}

function upsertStoredGame(gameToStore) {
  const games = getStoredGames();
  const index = games.findIndex(g => g.gameId === gameToStore.gameId);
  if (index >= 0) games[index] = gameToStore;
  else games.unshift(gameToStore);
  saveStoredGames(games);
  localStorage.setItem("ogActiveGameId", gameToStore.gameId);
  localStorage.setItem("ogSoftbalGame", JSON.stringify(gameToStore));
}

function showUnfinishedGames() {
  const list = document.getElementById("unfinishedGamesList");
  const games = getStoredGames().filter(g => !g.closed);

  if (!games.length) {
    list.innerHTML = `<p class="small-note">Geen niet afgesloten games gevonden.</p>`;
  } else {
    list.innerHTML = games.map(g => `
      <button class="game-list-button" onclick="loadGameById('${g.gameId}')">
        <strong>${g.opponent || "Onbekende tegenstander"}</strong>
        <small>${g.date || "-"} ${g.startTime || ""} · ${g.pitcherName || "Pitcher onbekend"} · ${g.pitches?.length || 0} pitches</small>
      </button>
    `).join("");
  }

  setActiveScreen("unfinishedGamesScreen");
}

function loadGameById(gameId) {
  const games = getStoredGames();
  const selected = games.find(g => g.gameId === gameId);
  if (!selected) {
    alert("Deze game kon niet worden geladen.");
    return;
  }

  game = {
    ...game,
    ...selected,
    appsScriptUrl: APPS_SCRIPT_URL
  };

  localStorage.setItem("ogActiveGameId", game.gameId);
  localStorage.setItem("ogSoftbalGame", JSON.stringify(game));
  showGame();
}

function renderLineupRows() {
  const holder = document.getElementById("lineupRows");
  if (!holder) return;

  holder.innerHTML = "";
  for (let i = 1; i <= 9; i++) {
    holder.innerHTML += `
      <div class="lineup-row">
        <div class="spot">${i}</div>
        <input id="name${i}" placeholder="Naam slagvrouw" />
        <input id="num${i}" placeholder="#" />
      </div>
    `;
  }
}

function fillDemoLineup() {
  const names = ["Emma", "Noor", "Lisa", "Sanne", "Mila", "Roos", "Tess", "Lotte", "Fleur"];
  names.forEach((name, index) => {
    document.getElementById(`name${index + 1}`).value = name;
    document.getElementById(`num${index + 1}`).value = [12, 7, 21, 4, 18, 10, 3, 25, 9][index];
  });
  document.getElementById("opponent").value = "Demo Team";
}

function renderChoices(elementId, options, key) {
  const holder = document.getElementById(elementId);
  if (!holder) return;

  holder.innerHTML = "";
  options.forEach(option => {
    const selected = game[key] === option ? "selected" : "";
    holder.innerHTML += `<button class="secondary ${selected}" onclick="selectChoice('${key}', '${option}')">${option}</button>`;
  });
}

function selectChoice(key, value) {
  game[key] = value;
  renderChoices("pitchTypes", pitchTypeOptions, "pitchType");
  renderChoices("results", resultOptions, "result");
}

function startGame() {
  game.pitcherName = document.getElementById("pitcherName").value;
  if (!game.pitcherName) {
    alert("Kies eerst een pitcher.");
    return;
  }

  const lineup = [];
  for (let i = 1; i <= 9; i++) {
    const name = document.getElementById(`name${i}`).value.trim();
    const number = document.getElementById(`num${i}`).value.trim();
    if (name || number) lineup.push({ order: i, name: name || `Slagvrouw ${i}`, number: number || "?" });
  }

  if (lineup.length === 0) {
    alert("Vul minimaal één slagvrouw in.");
    return;
  }

  game.opponent = document.getElementById("opponent").value.trim() || "Onbekende tegenstander";
  game.date = document.getElementById("gameDate").value;
  game.startTime = document.getElementById("gameTime").value;
  game.appsScriptUrl = APPS_SCRIPT_URL;
  game.gameId = `${Date.now()}-${game.date}-${game.startTime}-${game.opponent}-${game.pitcherName}`;
  game.closed = false;
  game.startedAt = new Date().toISOString();
  game.lineup = lineup;
  game.batterIndex = 0;
  game.balls = 0;
  game.strikes = 0;
  game.totalBalls = 0;
  game.totalStrikes = 0;
  game.firstPitchStrikes = 0;
  game.outs = 0;
  game.totalOuts = 0;
  game.pitches = [];

  saveLocalGame();
  setSyncStatus("Google Sheets nog niet getest.");
  showGame();
}

function showGame() {
  setActiveScreen("gameScreen");
  updateUI();
}

function setPitchLocation(event) {
  const field = document.getElementById("field");
  const rect = field.getBoundingClientRect();
  const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
  const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);

  game.pitchLocation = { x, y };

  const oldDot = field.querySelector(".pitch-dot");
  if (oldDot) oldDot.remove();

  const dot = document.createElement("div");
  dot.className = "pitch-dot";
  dot.style.left = `${x}%`;
  dot.style.top = `${y}%`;
  field.appendChild(dot);
}

function savePitch() {
  if (!game.pitchLocation) {
    alert("Tik eerst op de plek waar de bal kwam.");
    return;
  }

  const batter = game.lineup[game.batterIndex];
  const isFirstPitch = game.balls === 0 && game.strikes === 0;

  const pitch = {
    timestamp: new Date().toISOString(),
    opponent: game.opponent,
    pitcherName: game.pitcherName,
    date: game.date,
    startTime: game.startTime,
    batterOrder: batter.order,
    batterName: batter.name,
    batterNumber: batter.number,
    x: game.pitchLocation.x,
    y: game.pitchLocation.y,
    pitchType: game.pitchType,
    result: game.result,
    ballsBefore: game.balls,
    strikesBefore: game.strikes,
    outsBefore: game.totalOuts,
    firstPitch: isFirstPitch,
    walk: game.balls === 3 && game.result === "Ball"
  };

  game.pitches.unshift(pitch);

  if (isFirstPitch && ["Strike", "Swing", "Foul", "HIT", "Out"].includes(game.result)) {
    game.firstPitchStrikes += 1;
  }

  applyResult(game.result);
  game.pitchLocation = null;

  const dot = document.querySelector(".pitch-dot");
  if (dot) dot.remove();

  saveLocalGame();
  sendPitchToGoogleSheet(pitch);
  updateUI();
}

function applyResult(result) {
  if (result === "Ball") {
    game.balls += 1;
    game.totalBalls += 1;
  }

  if (["Strike", "Swing"].includes(result)) {
    game.strikes += 1;
    game.totalStrikes += 1;
  }

  if (result === "Foul" && game.strikes < 2) {
    game.strikes += 1;
    game.totalStrikes += 1;
  }

  if (result === "Out") {
    game.strikes += 1;
    game.totalStrikes += 1;
    addOut(false);
    nextBatter(false);
  }

  if (result === "HIT") {
    game.strikes += 1;
    game.totalStrikes += 1;
    nextBatter(false);
  }

  if (game.balls >= 4) nextBatter(false);

  if (game.strikes >= 3) {
    addOut(false);
    nextBatter(false);
  }
}

function nextBatter(shouldSave = true) {
  game.batterIndex = (game.batterIndex + 1) % game.lineup.length;
  resetCount(false);
  if (shouldSave) saveLocalGame();
  updateUI();
}

function addOut(shouldSave = true) {
  game.outs += 1;
  game.totalOuts += 1;
  if (shouldSave) saveLocalGame();
  updateUI();
}

function resetCount(shouldSave = true) {
  game.balls = 0;
  game.strikes = 0;
  if (shouldSave) saveLocalGame();
  updateUI();
}

function undoPitch() {
  if (game.pitches.length === 0) return;
  game.pitches.shift();
  alert("Pitch verwijderd. Let op: totalen worden in deze versie niet automatisch teruggezet.");
  saveLocalGame();
  updateUI();
}

function backToMenu() {
  showHome();
}

function resetGame() {
  if (!confirm("Wil je deze game afsluiten? Daarna staat hij niet meer bij 'Niet afgesloten games'.")) return;

  game.closed = true;
  game.closedAt = new Date().toISOString();
  saveLocalGame();

  localStorage.removeItem("ogActiveGameId");
  localStorage.removeItem("ogSoftbalGame");

  showHome();
}

function updateUI() {
  game.totalBalls = Number(game.totalBalls || 0);
  game.totalStrikes = Number(game.totalStrikes || 0);
  game.firstPitchStrikes = Number(game.firstPitchStrikes || 0);
  game.balls = Number(game.balls || 0);
  game.strikes = Number(game.strikes || 0);
  game.outs = Number(game.outs || 0);
  game.totalOuts = Number(game.totalOuts || 0);

  document.getElementById("balls").textContent = game.totalBalls;
  document.getElementById("totalStrikes").textContent = game.totalStrikes;
  document.getElementById("outs").textContent = game.totalOuts;
  document.getElementById("totalPitches").textContent = game.pitches.length;
  document.getElementById("fpsCount").textContent = game.firstPitchStrikes;
  document.getElementById("inningsPitched").textContent = formatInningsPitched(game.totalOuts);
  document.getElementById("currentBalls").textContent = game.balls;
  document.getElementById("currentStrikes").textContent = game.strikes;

  const batter = game.lineup[game.batterIndex] || { name: "Slagvrouw", number: "?", order: 1 };
  document.getElementById("batterName").textContent = batter.name;
  document.getElementById("batterMeta").textContent = `#${batter.number} · Line-up ${batter.order}`;

  const history = document.getElementById("history");
  history.innerHTML = game.pitches.slice(0, 8).map(p => `
    <div class="history-item">
      <span><b>${p.batterName} #${p.batterNumber}</b><br>${p.pitchType} · ${p.result} · x:${p.x}, y:${p.y}</span>
      <span>${new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  `).join("") || `<p class="small-note">Nog geen pitches opgeslagen.</p>`;

  renderBatterHeatmap();
}

function renderBatterHeatmap() {
  const heatmap = document.getElementById("heatmapField");
  if (!heatmap) return;

  heatmap.querySelectorAll(".heat-dot").forEach(dot => dot.remove());

  const batter = game.lineup[game.batterIndex];
  if (!batter) return;

  const batterPitches = game.pitches
    .filter(p => p.batterName === batter.name && String(p.batterNumber) === String(batter.number))
    .slice()
    .reverse();

  batterPitches.forEach((p, index) => {
    const dot = document.createElement("div");
    dot.className = "heat-dot";
    if (p.result === "HIT") dot.classList.add("hit");
    if (p.result === "Out") dot.classList.add("out");
    dot.style.left = `${p.x}%`;
    dot.style.top = `${p.y}%`;
    dot.title = `${p.pitchType} · ${p.result}`;
    dot.textContent = index + 1;
    heatmap.appendChild(dot);
  });

  document.getElementById("batterPitchCount").textContent = batterPitches.length;
  document.getElementById("batterHitCount").textContent = batterPitches.filter(p => p.result === "HIT").length;
  document.getElementById("batterOutCount").textContent = batterPitches.filter(p => p.result === "Out").length;
}

function formatInningsPitched(totalOuts) {
  return (Number(totalOuts || 0) / 3).toFixed(3);
}

async function sendPitchToGoogleSheet(pitch) {
  if (!game.appsScriptUrl) {
    setSyncStatus("Google Sheets niet gekoppeld.", "error");
    return;
  }

  try {
    await fetch(game.appsScriptUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "pitch",
        gameId: `${game.date}-${game.startTime}-${game.opponent}-${game.pitcherName}`,
        ...pitch,
        totalBalls: game.totalBalls,
        totalStrikes: game.totalStrikes,
        totalOuts: game.totalOuts,
        inningsPitched: formatInningsPitched(game.totalOuts),
        firstPitchStrike: pitch.firstPitch && ["Strike", "Swing", "Foul", "HIT", "Out"].includes(pitch.result)
      })
    });

    setSyncStatus("Pitch verzonden naar Google Sheets.", "ok");
  } catch (error) {
    console.error("Google Sheets sync error", error);
    setSyncStatus("Kon pitch niet verzenden naar Google Sheets.", "error");
  }
}

function setSyncStatus(message, type = "") {
  const status = document.getElementById("syncStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `sync-status ${type}`;
}

function saveLocalGame() {
  if (!game.gameId) {
    game.gameId = `${Date.now()}-${game.date || "game"}-${game.opponent || "tegenstander"}`;
  }
  upsertStoredGame(game);
}

function loadLocalGame() {
  const activeGameId = localStorage.getItem("ogActiveGameId");
  const games = getStoredGames();
  const activeGame = activeGameId ? games.find(g => g.gameId === activeGameId && !g.closed) : null;
  const saved = activeGame ? JSON.stringify(activeGame) : localStorage.getItem("ogSoftbalGame");
  if (!saved) return;

  try {
    const loaded = JSON.parse(saved);
    if (loaded.lineup && loaded.lineup.length && !loaded.closed) {
      game = {
        ...game,
        ...loaded,
        gameId: loaded.gameId || `${Date.now()}-${loaded.date || "game"}`,
        closed: Boolean(loaded.closed),
        totalBalls: Number(loaded.totalBalls || 0),
        totalStrikes: Number(loaded.totalStrikes || 0),
        firstPitchStrikes: Number(loaded.firstPitchStrikes || 0),
        balls: Number(loaded.balls || 0),
        strikes: Number(loaded.strikes || 0),
        outs: Number(loaded.outs || 0),
        totalOuts: Number(loaded.totalOuts || loaded.outs || 0),
        pitches: loaded.pitches || [],
        appsScriptUrl: APPS_SCRIPT_URL
      };
      saveLocalGame();
      showGame();
    }
  } catch (error) {
    console.warn("Kon opgeslagen wedstrijd niet laden", error);
  }
}

window.addEventListener("DOMContentLoaded", init);
