
const STRIKE_ZONE = {
  left: 28,
  right: 72,
  top: 18,
  bottom: 82
};

function getReadableZone(p) {
  const x = Number(p.x || 50);
  const y = Number(p.y || 50);

  // Buiten strikezone = wijd
  if (
    x < STRIKE_ZONE.left ||
    x > STRIKE_ZONE.right ||
    y < STRIKE_ZONE.top ||
    y > STRIKE_ZONE.bottom
  ) {
    return "Wijd";
  }

  const zoneWidth = STRIKE_ZONE.right - STRIKE_ZONE.left;
  const zoneHeight = STRIKE_ZONE.bottom - STRIKE_ZONE.top;

  const relativeX = (x - STRIKE_ZONE.left) / zoneWidth;
  const relativeY = (y - STRIKE_ZONE.top) / zoneHeight;

  // Horizontaal:
  // 25% inside
  // 50% midden
  // 25% outside
  let horizontal = "Middle";

  if (relativeX <= 0.25) {
    horizontal = "Inside";
  } else if (relativeX >= 0.75) {
    horizontal = "Outside";
  }

  // Verticaal:
  // 25% hoog
  // 50% midden
  // 25% laag
  let vertical = "Midden";

  if (relativeY <= 0.25) {
    vertical = "Hoog";
  } else if (relativeY >= 0.75) {
    vertical = "Laag";
  }

  if (horizontal === "Middle" && vertical === "Midden") {
    return "Middle-middle";
  }

  if (horizontal === "Middle") {
    return vertical;
  }

  if (vertical === "Midden") {
    return horizontal;
  }

  return `${vertical} ${horizontal}`;
}






let sitePassword = "";
let isAuthenticated = false;



function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `ogCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");

    window[callbackName] = data => {
      resolve(data);
      script.remove();
      delete window[callbackName];
    };

    script.onerror = () => {
      script.remove();
      delete window[callbackName];
      reject(new Error("Apps Script kon niet worden geladen"));
    };

    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  });
}

async function fetchSitePassword() {
  try {
    const payload = await loadJsonp(APPS_SCRIPT_URL);
    sitePassword = String(payload.sitePassword || "").trim();
    return sitePassword;
  } catch (error) {
    console.error("Kon site wachtwoord niet ophalen", error);
    return "";
  }
}

async function verifySitePassword() {
  const input = document.getElementById("sitePasswordInput");
  const error = document.getElementById("loginError");
  const entered = String(input?.value || "").trim();

  const correctPassword = await fetchSitePassword();

  if (entered && correctPassword && entered === correctPassword) {
    isAuthenticated = true;
    if (error) error.classList.add("hidden");
    showHome();
      return;
  }

  if (error) {
    error.textContent = "Ongeldig wachtwoord of wachtwoord kon niet worden geladen";
    error.classList.remove("hidden");
  }
}

function showHome() {
  if (!isAuthenticated) {
    showLoginScreen();
    return;
  }

  setActiveScreen("homeScreen");
}

function goHomeIfAuthenticated() {
  if (!isAuthenticated) {
    showLoginScreen();
    return;
  }

  showHome();
}

async 


async 



// OG Pitching Tracker

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby_SD7MDqIzOD8FIrpjh-XwaqMlz5epHVMt88upepu1x96ss8B0LXWSYbzZ-F8yrH6W/exec";

const pitchTypeOptions = ["Fastball", "Slowball", "Overig"];
const resultOptions = ["Ball", "Strike", "Swing", "Foul", "HIT", "Out"];

let sheetSyncLoaded = false;
let sheetGames = [];

let game = {
  opponent: "",
  pitcherName: "",
  pitcherSessions: [],
  date: "",
  startTime: "",
  lineup: [],
  activeLineupSize: 9,
  substitutionHistory: [],
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
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
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

  for (let i = 1; i <= 16; i++) {
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
  syncFromGoogleSheet().then(() => renderPitcherStats());
}

function getPitcherGames(pitcherName) {
  return getStoredGames()
    .map(g => {
      const pitcherPitches = (g.pitches || []).filter(p => p.pitcherName === pitcherName);
      if (!pitcherPitches.length) return null;

      return {
        ...g,
        pitcherName,
        pitches: pitcherPitches,
        totalOuts: getPitcherOutsFromPitches(pitcherPitches),
        totalBalls: pitcherPitches.filter(p => p.result === "Ball").length,
        totalStrikes: pitcherPitches.filter(p => ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)).length,
        firstPitchStrikes: pitcherPitches.filter(p => p.firstPitch && ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)).length
      };
    })
    .filter(Boolean);
}



function getPitcherOutsFromPitches(pitches) {
  if (!Array.isArray(pitches) || !pitches.length) return 0;

  const totals = pitches
    .map(p => Number(p.totalOuts || 0))
    .filter(n => Number.isFinite(n));

  if (totals.length && Math.max(...totals) > 0) {
    return Math.max(...totals);
  }

  return pitches.filter(p => p.result === "Out").length;
}

function calculateGameStats(g) {
  const pitches = g.pitches || [];
  const totalPitches = pitches.length;

  const strikes = pitches.filter(p =>
    ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)
  ).length;

  const balls = pitches.filter(p => p.result === "Ball").length;
  const outs = getPitcherOutsFromPitches(pitches);

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
  setActiveScreen("batterSearchScreen");
  syncFromGoogleSheet().then(() => {
    populateBatterOpponentFilter();
    populateBatterPlayerFilter();
    renderBatterSearch();
  });
}

function populateBatterPlayerFilter() {
  const opponentSelect = document.getElementById("batterSearchOpponent");
  const playerSelect = document.getElementById("batterSearchPlayer");
  if (!playerSelect) return;

  const selectedOpponent = opponentSelect ? opponentSelect.value : "";
  const allPitches = getAllPitchesFromStoredGames()
    .filter(p => !selectedOpponent || p.gameOpponent === selectedOpponent);

  const playersMap = new Map();

  allPitches.forEach(p => {
    const name = String(p.batterName || "").trim();
    const number = String(p.batterNumber || "").trim();
    if (!name && !number) return;

    const key = `${name}|${number}`;
    if (!playersMap.has(key)) {
      playersMap.set(key, {
        name: name || "Onbekende slagvrouw",
        number: number || "?",
        label: `${name || "Onbekende slagvrouw"} #${number || "?"}`
      });
    }
  });

  const players = Array.from(playersMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  const current = playerSelect.value;

  if (!selectedOpponent) {
    playerSelect.innerHTML = `<option value="">Kies eerst een tegenstander</option>`;
    return;
  }

  if (!players.length) {
    playerSelect.innerHTML = `<option value="">Geen speelsters gevonden</option>`;
    return;
  }

  playerSelect.innerHTML = `<option value="">Kies slagvrouw</option>` + players.map(player =>
    `<option value="${player.name}|${player.number}">${player.label}</option>`
  ).join("");

  if ([...playerSelect.options].some(option => option.value === current)) {
    playerSelect.value = current;
  }
}

function populateBatterOpponentFilter() {
  const select = document.getElementById("batterSearchOpponent");
  if (!select) return;

  const opponents = [...new Set(getStoredGames().map(g => g.opponent).filter(Boolean))].sort();
  const current = select.value;

  select.innerHTML = `<option value="">Kies tegenstander</option>` + opponents.map(o =>
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
  const opponentSelect = document.getElementById("batterSearchOpponent");
  const playerSelect = document.getElementById("batterSearchPlayer");

  const selectedOpponent = opponentSelect ? opponentSelect.value : "";
  const selectedPlayer = playerSelect ? playerSelect.value : "";
  const heatmap = document.getElementById("batterSearchHeatmap");
  const body = document.getElementById("batterSearchTableBody");

  if (heatmap) heatmap.querySelectorAll(".heat-dot").forEach(dot => dot.remove());

  if (!selectedOpponent || !selectedPlayer) {
    document.getElementById("batterSearchPitches").textContent = "0";
    document.getElementById("batterSearchHits").textContent = "0";
    document.getElementById("batterSearchOuts").textContent = "0";
    document.getElementById("batterSearchBalls").textContent = "0";
    document.getElementById("batterSearchStrikes").textContent = "0";
    document.getElementById("batterSearchGames").textContent = "0";
    body.innerHTML = `<tr><td colspan="6">Kies een tegenstander en slagvrouw.</td></tr>`;
    return;
  }

  const [selectedName, selectedNumber] = selectedPlayer.split("|");

  const matches = getAllPitchesFromStoredGames().filter(p => {
    return p.gameOpponent === selectedOpponent &&
      String(p.batterName || "") === selectedName &&
      String(p.batterNumber || "") === selectedNumber;
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
  const x = Number(p.x || 50);
  const y = Number(p.y || 50);

  // Buiten strikezone
  if (x < 28 || x > 72 || y < 18 || y > 82) {
    return "Wijd";
  }

  let horizontal = "";
  let vertical = "";

  // Horizontal finer tuning
  if (x < 40) horizontal = "Inside";
  else if (x > 60) horizontal = "Outside";
  else horizontal = "Middle";

  // Vertical finer tuning
  if (y < 38) vertical = "Hoog";
  else if (y > 62) vertical = "Laag";
  else vertical = "Midden";

  if (horizontal === "Middle" && vertical === "Midden") {
    return "Middle-middle";
  }

  if (horizontal === "Middle") return vertical;
  if (vertical === "Midden") return horizontal;

  return `${vertical} ${horizontal}`;
}















// Backwards compatible oude naam
















function renderLineupRows() {
  const holder = document.getElementById("lineupRows");
  if (!holder) return;

  holder.innerHTML = "";
  for (let i = 1; i <= 16; i++) {
    holder.innerHTML += `
      <div class="lineup-row">
        <div class="spot">${i}</div>
        <input id="name${i}" placeholder="${i <= 9 ? 'Naam slagvrouw' : 'Bench speler'}" />
        <input id="num${i}" placeholder="#" />
      </div>
    `;
  }
}

function fillDemoLineup() {
  const names = ["Emma", "Noor", "Lisa", "Sanne", "Mila", "Roos", "Tess", "Lotte", "Fleur", "Jade", "Isa", "Liv", "Zoë", "Nova", "Evi", "Sara"];
  const numbers = [12, 7, 21, 4, 18, 10, 3, 25, 9, 14, 6, 31, 22, 11, 15, 28];

  names.forEach((name, index) => {
    document.getElementById(`name${index + 1}`).value = name;
    document.getElementById(`num${index + 1}`).value = numbers[index];
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


function requireEditPassword(message = "Voer wachtwoord in om deze game te openen/wijzigen:") {
  const password = prompt(message);
  return password === "Edit";
}







// Oude naam blijft bestaan, maar gaat nu verplicht via wachtwoord.










function requireEditPassword(message = "Voer wachtwoord in om deze game te openen/wijzigen:") {
  const password = prompt(message);
  return password === "Edit";
}

function showUnfinishedGames() {
  setActiveScreen("unfinishedGamesScreen");
  const list = document.getElementById("unfinishedGamesList");
  if (list) list.innerHTML = `<p class="small-note">Niet afgesloten games worden geladen...</p>`;

  syncFromGoogleSheet()
    .catch(() => [])
    .finally(() => renderUnfinishedGames());
}

function renderUnfinishedGames() {
  const list = document.getElementById("unfinishedGamesList");
  if (!list) return;

  const games = getStoredGames()
    .filter(g => !Boolean(g.closed))
    .sort((a, b) => String(b.startedAt || b.date || "").localeCompare(String(a.startedAt || a.date || "")));

  if (!games.length) {
    list.innerHTML = `<p class="small-note">Geen niet afgesloten games gevonden.</p>`;
    return;
  }

  list.innerHTML = games.map(g => `
    <button class="game-list-button" onclick="loadUnfinishedGame('${g.gameId}')">
      <strong>${g.opponent || "Onbekende tegenstander"}</strong>
      <small>${g.date || "-"} ${g.startTime || ""} · ${g.pitcherName || "Pitcher onbekend"} · ${g.pitches?.length || 0} pitches</small>
    </button>
  `).join("");
}

function loadUnfinishedGame(gameId) {
  if (!requireEditPassword("Voer wachtwoord in om deze niet afgesloten game te openen/wijzigen:")) {
    alert("Geen toegang om deze game te openen.");
    return;
  }

  const selected = getStoredGames().find(g => g.gameId === gameId);
  if (!selected) {
    alert("Deze game kon niet worden geladen.");
    return;
  }

  game = {
    ...game,
    ...selected,
    appsScriptUrl: APPS_SCRIPT_URL
  };

  showGame();
}

function loadGameById(gameId) {
  loadUnfinishedGame(gameId);
}

function showPreviousGames() {
  setActiveScreen("previousGamesScreen");
  const list = document.getElementById("previousGamesList");
  if (list) list.innerHTML = `<p class="small-note">Vorige games worden geladen...</p>`;

  syncFromGoogleSheet()
    .catch(() => [])
    .finally(() => renderPreviousGames());
}

function renderPreviousGames() {
  const list = document.getElementById("previousGamesList");
  const input = document.getElementById("previousGamesSearch");
  if (!list) return;

  const query = (input?.value || "").trim().toLowerCase();
  let rows = [];

  getStoredGames()
    .filter(g => Boolean(g.closed))
    .forEach(g => {
      const pitches = g.pitches || [];
      const pitchers = [...new Set(pitches.map(p => p.pitcherName).filter(Boolean))];

      pitchers.forEach(pitcherName => {
        const pitcherPitches = pitches.filter(p => p.pitcherName === pitcherName);
        const strikes = pitcherPitches.filter(p => ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)).length;
        const balls = pitcherPitches.filter(p => p.result === "Ball").length;
        const outs = getPitcherOutsFromPitches(pitcherPitches);
        const fps = pitcherPitches.filter(p => p.firstPitch && ["Strike", "Swing", "Foul", "HIT", "Out"].includes(p.result)).length;
        const batters = pitcherPitches.filter(p => p.firstPitch).length;

        rows.push({
          gameId: g.gameId,
          date: g.date || "",
          startTime: g.startTime || "",
          opponent: g.opponent || "Onbekende tegenstander",
          pitcherName,
          pitches: pitcherPitches.length,
          strikes,
          balls,
          outs,
          ip: formatInningsPitched(outs),
          fps,
          batters
        });
      });
    });

  if (query) {
    rows = rows.filter(row =>
      String(row.date).toLowerCase().includes(query) ||
      String(row.opponent).toLowerCase().includes(query) ||
      String(row.pitcherName).toLowerCase().includes(query) ||
      String(row.startTime).toLowerCase().includes(query)
    );
  }

  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  if (!rows.length) {
    list.innerHTML = `<p class="small-note">Geen afgesloten pitching appearances gevonden.</p>`;
    return;
  }

  list.innerHTML = rows.map(row => `
    <button class="game-list-button" onclick="loadArchivedGame('${row.gameId}')">
      <strong>${row.pitcherName}</strong>
      <small>${row.date || "-"} ${row.startTime || ""} · vs ${row.opponent}</small>
      <div class="game-meta-row">
        <div class="game-meta-pill">${row.pitches} P</div>
        <div class="game-meta-pill">${row.strikes} S</div>
        <div class="game-meta-pill">${row.balls} B</div>
        <div class="game-meta-pill">${row.outs} Outs</div>
        <div class="game-meta-pill">${row.ip} IP</div>
        <div class="game-meta-pill">FPS ${row.fps}/${row.batters}</div>
      </div>
    </button>
  `).join("");
}

function loadArchivedGame(gameId) {
  if (!requireEditPassword("Deze vorige game is afgesloten. Voer wachtwoord in om te wijzigen:")) {
    alert("Geen toegang om vorige games aan te passen.");
    return;
  }

  const selected = getStoredGames().find(g => g.gameId === gameId);
  if (!selected) {
    alert("Deze game kon niet worden geladen.");
    return;
  }

  game = {
    ...game,
    ...selected,
    closed: false,
    appsScriptUrl: APPS_SCRIPT_URL
  };

  saveLocalGame();
  showGame();
}

function continuePreviousGame() {
  showUnfinishedGames();
}


function startGame() {
  game.pitcherName = document.getElementById("pitcherName").value;
  game.pitcherSessions = [];
  if (!game.pitcherName) {
    alert("Kies eerst een pitcher.");
    return;
  }

  const lineup = [];
  for (let i = 1; i <= 16; i++) {
    const name = document.getElementById(`name${i}`).value.trim();
    const number = document.getElementById(`num${i}`).value.trim();
    if (name || number) lineup.push({ order: i, name: name || `Slagvrouw ${i}`, number: number || "?" });
  }

  const activeLineup = lineup.filter(player => player.order <= 9);
  if (activeLineup.length < 9) {
    alert("Vul minimaal de actieve slaglijst 1 t/m 9 in.");
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
  game.activeLineupSize = 9;
  game.substitutionHistory = [];
  game.batterIndex = 0;
  game.balls = 0;
  game.strikes = 0;
  game.totalBalls = 0;
  game.totalStrikes = 0;
  game.firstPitchStrikes = 0;
  game.outs = 0;
  game.totalOuts = 0;
  game.pitches = [];
  game.pitcherSessions = [];
  startPitcherSession(game.pitcherName);
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
  game.batterIndex = (game.batterIndex + 1) % Number(game.activeLineupSize || 9);
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







function startPitcherSession(pitcherName) {
  game.pitcherSessions = game.pitcherSessions || [];
  game.pitcherSessions.push({
    pitcherName,
    startedAt: new Date().toISOString(),
    endedAt: "",
    startPitchCount: game.pitches?.length || 0,
    endPitchCount: null
  });
}

function closeCurrentPitcherSession() {
  game.pitcherSessions = game.pitcherSessions || [];
  const current = [...game.pitcherSessions].reverse().find(session => !session.endedAt);
  if (current) {
    current.endedAt = new Date().toISOString();
    current.endPitchCount = game.pitches?.length || 0;
  }
}

function openPitcherModal() {
  const modal = document.getElementById("pitcherModal");
  const select = document.getElementById("newPitcherSelect");

  if (!modal || !select) {
    alert("Pitcher popup kon niet worden geopend.");
    return;
  }

  select.value = "";
  [...select.options].forEach(option => {
    option.disabled = option.value === game.pitcherName && option.value !== "";
  });

  modal.classList.remove("hidden");
}

function closePitcherModal() {
  const modal = document.getElementById("pitcherModal");
  if (modal) modal.classList.add("hidden");
}

function confirmPitcherChange() {
  const select = document.getElementById("newPitcherSelect");
  const newPitcher = select?.value;

  if (!newPitcher) {
    alert("Kies eerst een nieuwe pitcher.");
    return;
  }

  if (newPitcher === game.pitcherName) {
    alert("Deze pitcher is al actief.");
    return;
  }

  closeCurrentPitcherSession();

  game.pitcherName = newPitcher;

  // Pitching-count/statline opnieuw beginnen voor de nieuwe pitcher.
  game.balls = 0;
  game.strikes = 0;
  game.totalBalls = 0;
  game.totalStrikes = 0;
  game.firstPitchStrikes = 0;
  game.outs = 0;
  game.totalOuts = 0;

  startPitcherSession(newPitcher);
  saveLocalGame();
  closePitcherModal();
  updateUI();

  setSyncStatus(`Nieuwe pitcher actief: ${newPitcher}`, "ok");
}


function openSubModal() {
  const activeSelect = document.getElementById("activeSubSelect");
  const benchSelect = document.getElementById("benchSubSelect");

  const activePlayers = game.lineup.filter(player => player.order <= Number(game.activeLineupSize || 9));
  const benchPlayers = game.lineup.filter(player => player.order > Number(game.activeLineupSize || 9));

  activeSelect.innerHTML = activePlayers.map((player, index) =>
    `<option value="${index}">${player.order}. ${player.name} #${player.number}</option>`
  ).join("");

  benchSelect.innerHTML = benchPlayers.map(player =>
    `<option value="${player.order}">${player.order}. ${player.name} #${player.number}</option>`
  ).join("");

  if (!benchPlayers.length) {
    benchSelect.innerHTML = `<option value="">Geen bench spelers ingevuld</option>`;
  }

  document.getElementById("subModal").classList.remove("hidden");
}

function closeSubModal() {
  document.getElementById("subModal").classList.add("hidden");
}

function confirmSubstitution() {
  const activeIndex = Number(document.getElementById("activeSubSelect").value);
  const benchOrder = Number(document.getElementById("benchSubSelect").value);

  if (Number.isNaN(activeIndex) || Number.isNaN(benchOrder)) {
    alert("Kies een actieve speelster en een bench speelster.");
    return;
  }

  const benchIndex = game.lineup.findIndex(player => player.order === benchOrder);
  if (benchIndex < 0) {
    alert("Bench speelster niet gevonden.");
    return;
  }

  const activePlayer = { ...game.lineup[activeIndex] };
  const benchPlayer = { ...game.lineup[benchIndex] };

  // Slagpositie blijft gelijk; speelster wordt gewisseld.
  game.lineup[activeIndex] = {
    ...benchPlayer,
    order: activePlayer.order
  };

  // Gewisselde speelster gaat naar de benchplek.
  game.lineup[benchIndex] = {
    ...activePlayer,
    order: benchPlayer.order
  };

  game.substitutionHistory = game.substitutionHistory || [];
  game.substitutionHistory.push({
    timestamp: new Date().toISOString(),
    activeSlot: activePlayer.order,
    outPlayerName: activePlayer.name,
    outPlayerNumber: activePlayer.number,
    inPlayerName: benchPlayer.name,
    inPlayerNumber: benchPlayer.number
  });

  saveLocalGame();
  closeSubModal();
  updateUI();
}


function backToMenu() {
  showHome();
}

function resetGame() {
  if (!confirm("Wil je deze game afsluiten? Daarna staat hij bij 'Vorige games'.")) return;

  game.closed = true;
  game.closedAt = new Date().toISOString();

  upsertStoredGame(game);
  sendGameStatusToGoogleSheet();

  showHome();
}

function getActivePitcherPitchCount() {
  if (!game.pitcherName) return 0;
  return (game.pitches || []).filter(p => p.pitcherName === game.pitcherName).length;
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
  document.getElementById("totalPitches").textContent = getActivePitcherPitchCount();
  document.getElementById("fpsCount").textContent = game.firstPitchStrikes;
  document.getElementById("inningsPitched").textContent = formatInningsPitched(game.totalOuts);
  const activePitcherLabel = document.getElementById("activePitcherLabel");
  if (activePitcherLabel) activePitcherLabel.textContent = game.pitcherName || "-";
  document.getElementById("currentBalls").textContent = game.balls;
  document.getElementById("currentStrikes").textContent = game.strikes;

  const batter = game.lineup[game.batterIndex] || { name: "Slagvrouw", number: "?", order: 1 };
  document.getElementById("batterName").textContent = batter.name;
  document.getElementById("batterMeta").textContent = `#${batter.number} · Line-up ${batter.order}`;

  const history = document.getElementById("history");
  history.innerHTML = game.pitches.slice(0, 8).map(p => `
    <div class="history-item">
      <span><b>${p.batterName} #${p.batterNumber}</b><br>${p.pitchType} · ${p.result} · ${getReadableZone(p)}</span>
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

function getPitchZone(x, y) {
  const zoneLeft = 54;
  const zoneRight = 92;
  const zoneTop = 18;
  const zoneBottom = 72;

  const insideZone = x >= zoneLeft && x <= zoneRight && y >= zoneTop && y <= zoneBottom;

  if (!insideZone) {
    return { horizontal: "Wijd", vertical: "Wijd", label: "Wijd" };
  }

  const zoneWidth = zoneRight - zoneLeft;
  const zoneHeight = zoneBottom - zoneTop;

  let horizontal = "Midden";
  if (x < zoneLeft + zoneWidth / 3) horizontal = "Inside";
  else if (x > zoneLeft + (zoneWidth / 3) * 2) horizontal = "Outside";

  let vertical = "Midden";
  if (y < zoneTop + zoneHeight / 3) vertical = "Hoog";
  else if (y > zoneTop + (zoneHeight / 3) * 2) vertical = "Laag";

  return { horizontal, vertical, label: `${horizontal} ${vertical}` };
}

async function sendGameStatusToGoogleSheet() {
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
        type: "game_status",
        gameId: game.gameId,
        date: game.date,
        startTime: game.startTime,
        opponent: game.opponent,
        pitcherName: game.pitcherName,
        closed: true,
        closedAt: game.closedAt || new Date().toISOString(),
        totalBalls: game.totalBalls,
        totalStrikes: game.totalStrikes,
        totalOuts: game.totalOuts,
        inningsPitched: formatInningsPitched(game.totalOuts),
        totalPitches: getActivePitcherPitchCount(),
        firstPitchStrikes: game.firstPitchStrikes || 0
      })
    });

    setSyncStatus("Game afgesloten en verzonden naar Google Sheets.", "ok");
  } catch (error) {
    console.error("Game status sync error", error);
    setSyncStatus("Kon game status niet verzenden naar Google Sheets.", "error");
  }
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
        gameId: game.gameId || `${game.date}-${game.startTime}-${game.opponent}-${game.pitcherName}`,
        ...pitch,
        totalBalls: game.totalBalls,
        totalStrikes: game.totalStrikes,
        totalOuts: game.totalOuts,
        inningsPitched: formatInningsPitched(game.totalOuts),
        firstPitchStrike: pitch.firstPitch && ["Strike", "Swing", "Foul", "HIT", "Out"].includes(pitch.result),
        zoneHorizontal: pitch.zoneHorizontal,
        zoneVertical: pitch.zoneVertical,
        zoneLabel: pitch.zoneLabel,
        walk: pitch.walk
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











function getStoredGames() {
  const activeGame = game && game.gameId && !game.closed ? [game] : [];
  const ids = new Set(activeGame.map(g => g.gameId));
  return [...activeGame, ...sheetGames.filter(g => !ids.has(g.gameId))];
}

function saveStoredGames(games) {
  sheetGames = Array.isArray(games) ? games : [];
}

function upsertStoredGame(gameToStore) {
  if (!gameToStore || !gameToStore.gameId) return;

  const index = sheetGames.findIndex(g => g.gameId === gameToStore.gameId);
  if (index >= 0) sheetGames[index] = gameToStore;
  else sheetGames.unshift(gameToStore);
}

function saveLocalGame() {
  // Geen browseropslag meer. Actieve wedstrijd leeft alleen tijdelijk in geheugen.
  upsertStoredGame(game);
}

function syncFromGoogleSheet() {
  setSyncStatus("Google Sheets wordt geladen...", "loading");

  return loadSheetDataJsonp()
    .then(payload => {
      const games = convertSheetRowsToGames(payload);
      const merged = mergeGames([], games);
      saveStoredGames(merged);

      sheetSyncLoaded = true;
      setSyncStatus(`Google Sheets geladen: ${games.length} games.`, "ok");

      if (document.getElementById("pitcherStatsScreen")?.classList.contains("active")) renderPitcherStats();
      if (document.getElementById("batterSearchScreen")?.classList.contains("active")) {
        populateBatterOpponentFilter();
        populateBatterPlayerFilter();
        renderBatterSearch();
      }
      if (document.getElementById("previousGamesScreen")?.classList.contains("active")) renderPreviousGames();
      if (document.getElementById("unfinishedGamesScreen")?.classList.contains("active")) renderUnfinishedGames();

      return games;
    })
    .catch(error => {
      console.error("Google Sheets lezen mislukt", error);
      setSyncStatus("Kon Google Sheets niet teruglezen.", "error");
      return [];
    });
}

function loadSheetDataJsonp() {
  return loadJsonp(APPS_SCRIPT_URL);
}

function mergeGames(localGames, sheetGamesFromServer) {
  const activeGame = game && game.gameId && !game.closed ? [game] : [];
  const activeIds = new Set(activeGame.map(g => g.gameId));
  return [...activeGame, ...sheetGamesFromServer.filter(g => !activeIds.has(g.gameId))];
}

function convertSheetRowsToGames(payload) {
  if (!payload || !payload.rows || !payload.rows.length) return [];

  const headers = payload.headers || [];
  const rows = payload.rows;

  const get = (record, names, fallbackIndex = null) => {
    for (const name of names) {
      if (record[name] !== undefined && record[name] !== "") return record[name];
    }
    if (fallbackIndex !== null) return record[`_${fallbackIndex}`];
    return "";
  };

  const records = rows.map(row => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || "").trim()] = row[index];
      record[`_${index}`] = row[index];
    });
    return record;
  });

  const games = new Map();

  records.forEach(record => {
    const rowType = String(get(record, ["Row Type", "type"], 0) || "").trim();
    const gameId = String(get(record, ["Game ID", "gameId"], rowType ? 2 : 1) || "").trim();
    if (!gameId) return;

    const date = get(record, ["Datum", "date"], rowType ? 3 : 2);
    const startTime = get(record, ["Starttijd", "startTime"], rowType ? 4 : 3);
    const opponent = get(record, ["Tegenstander", "opponent"], rowType ? 5 : 4);
    const pitcherName = get(record, ["Pitcher", "pitcherName"], rowType ? 6 : 5);

    if (rowType === "game_status") {
      if (!games.has(gameId)) {
        games.set(gameId, {
          gameId,
          date,
          startTime,
          opponent,
          pitcherName,
          lineup: [],
          activeLineupSize: 9,
          substitutionHistory: [],
          pitcherSessions: [],
          batterIndex: 0,
          balls: 0,
          strikes: 0,
          totalBalls: 0,
          totalStrikes: 0,
          firstPitchStrikes: 0,
          outs: 0,
          totalOuts: 0,
          pitches: [],
          closed: true,
          closedAt: get(record, ["Closed At", "closedAt"], 29),
          appsScriptUrl: APPS_SCRIPT_URL
        });
      }

      const g = games.get(gameId);
      g.closed = true;
      g.closedAt = get(record, ["Closed At", "closedAt"], 29) || g.closedAt;
      g.totalBalls = Number(get(record, ["Total Balls", "totalBalls"], 25) || g.totalBalls || 0);
      g.totalStrikes = Number(get(record, ["Total Strikes", "totalStrikes"], 26) || g.totalStrikes || 0);
      g.totalOuts = Number(get(record, ["Total Outs", "totalOuts"], 27) || g.totalOuts || 0);
      return;
    }

    const pitch = {
      timestamp: get(record, ["Timestamp", "timestamp"], 0),
      gameId,
      date,
      startTime,
      opponent,
      pitcherName,
      batterOrder: Number(get(record, ["Batter Order", "batterOrder"], 6) || 0),
      batterName: get(record, ["Slagvrouw", "batterName"], 7),
      batterNumber: get(record, ["Rugnummer", "batterNumber"], 8),
      x: Number(get(record, ["X", "x"], 9)),
      y: Number(get(record, ["Y", "y"], 10)),
      zoneHorizontal: get(record, ["Zone Horizontal", "zoneHorizontal"], 11),
      zoneVertical: get(record, ["Zone Vertical", "zoneVertical"], 12),
      zoneLabel: get(record, ["Zone Label", "zoneLabel"], 13),
      pitchType: get(record, ["Pitch Type", "pitchType"], 14),
      result: get(record, ["Resultaat", "result"], 15),
      ballsBefore: Number(get(record, ["Balls Before", "ballsBefore"], 16) || 0),
      strikesBefore: Number(get(record, ["Strikes Before", "strikesBefore"], 17) || 0),
      outsBefore: Number(get(record, ["Outs Before", "outsBefore"], 18) || 0),
      firstPitch: parseBool(get(record, ["First Pitch", "firstPitch"], 19)),
      firstPitchStrike: parseBool(get(record, ["First Pitch Strike", "firstPitchStrike"], 20)),
      totalBalls: Number(get(record, ["Total Balls", "totalBalls"], 21) || 0),
      totalStrikes: Number(get(record, ["Total Strikes", "totalStrikes"], 22) || 0),
      totalOuts: Number(get(record, ["Total Outs", "totalOuts"], rowType ? 24 : 23) || 0),
      inningsPitched: get(record, ["Innings Pitched", "inningsPitched"], 24),
      walk: parseBool(get(record, ["Walk", "walk"], 25))
    };

    if (!games.has(gameId)) {
      games.set(gameId, {
        gameId,
        date,
        startTime,
        opponent,
        pitcherName,
        lineup: [],
  activeLineupSize: 9,
  substitutionHistory: [],
        batterIndex: 0,
        balls: 0,
        strikes: 0,
        totalBalls: 0,
        totalStrikes: 0,
        firstPitchStrikes: 0,
        outs: 0,
        totalOuts: 0,
        pitches: [],
        closed: rowType === "game_status" ? true : parseBool(get(record, ["Closed", "closed"], 28)),
        appsScriptUrl: APPS_SCRIPT_URL
      });
    }

    const g = games.get(gameId);
    g.pitches.push(pitch);

    if (pitch.batterName || pitch.batterNumber) {
      const exists = g.lineup.some(b =>
        b.name === pitch.batterName && String(b.number) === String(pitch.batterNumber)
      );
      if (!exists) {
        g.lineup.push({
          order: pitch.batterOrder || g.lineup.length + 1,
          name: pitch.batterName || `Slagvrouw ${g.lineup.length + 1}`,
          number: pitch.batterNumber || "?"
        });
      }
    }

    g.totalBalls = Math.max(g.totalBalls, pitch.totalBalls || 0);
    g.totalStrikes = Math.max(g.totalStrikes, pitch.totalStrikes || 0);
    g.totalOuts = Math.max(g.totalOuts, pitch.totalOuts || 0);
    if (pitch.firstPitchStrike) g.firstPitchStrikes += 1;
  });

  return Array.from(games.values()).map(g => ({
    ...g,
    pitches: g.pitches.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  }));
}

function parseBool(value) {
  return value === true || value === "TRUE" || value === "true" || value === "Ja" || value === "1";
}




function loadLocalGame() {
  return null;
}

window.addEventListener("DOMContentLoaded", init);


function showLoginScreen() {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  const login = document.getElementById("loginScreen");
  if (login) login.classList.add("active");
}

window.addEventListener("load", async () => {
  await fetchSitePassword();
  showLoginScreen();
});
