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
  appsScriptUrl: APPS_SCRIPT_URL
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
  setActiveScreen("setupScreen");
}

function showPlaceholder(title) {
  document.getElementById("placeholderTitle").textContent = title;
  setActiveScreen("placeholderScreen");
}

function continuePreviousGame() {
  const saved = localStorage.getItem("ogSoftbalGame");
  if (!saved) {
    alert("Er is nog geen vorige game opgeslagen op dit apparaat.");
    return;
  }
  loadLocalGame();
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
    firstPitch: isFirstPitch
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
  if (!confirm("Weet je zeker dat je de wedstrijd wilt resetten?")) return;
  localStorage.removeItem("ogSoftbalGame");
  location.reload();
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
  localStorage.setItem("ogSoftbalGame", JSON.stringify(game));
}

function loadLocalGame() {
  const saved = localStorage.getItem("ogSoftbalGame");
  if (!saved) return;

  try {
    const loaded = JSON.parse(saved);
    if (loaded.lineup && loaded.lineup.length) {
      game = {
        ...game,
        ...loaded,
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
      showGame();
    }
  } catch (error) {
    console.warn("Kon opgeslagen wedstrijd niet laden", error);
  }
}

window.addEventListener("DOMContentLoaded", init);
