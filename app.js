const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxioW-DGTZyuJ537C3H9zEv22yeaijzZ6I19b2F4mJiPCnytWpo-ov9SbNC9iKaTIZ5Gg/exec";
let sitePassword = "";
let isAuthenticated = false;


const STRIKE_ZONE = {
  left: 54,
  right: 92,
  top: 18,
  bottom: 72
};


function formatDateTimeCompact(dateValue, timeValue) {
  const rawDate = String(dateValue || "").trim();
  const rawTime = String(timeValue || "").trim();

  let day = "--";
  let month = "--";

  if (rawDate) {
    const isIsoDateTime = /T\d{2}:\d{2}:\d{2}/.test(rawDate);
    const isoDateOnlyMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const nlMatch = rawDate.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);

    if (isIsoDateTime) {
      // Google Sheets kan een datum als UTC ISO sturen, bv. 2026-05-08T22:00:00.000Z.
      // Die moet lokaal worden gelezen zodat dit 09-05 wordt.
      const parsed = new Date(rawDate);
      if (!Number.isNaN(parsed.getTime())) {
        day = String(parsed.getDate()).padStart(2, "0");
        month = String(parsed.getMonth() + 1).padStart(2, "0");
      }
    } else if (isoDateOnlyMatch) {
      // Echte date-only waarde niet via new Date parsen, om timezone-shifts te voorkomen.
      day = isoDateOnlyMatch[3];
      month = isoDateOnlyMatch[2];
    } else if (nlMatch) {
      day = nlMatch[1].padStart(2, "0");
      month = nlMatch[2].padStart(2, "0");
    } else {
      const parsed = new Date(rawDate);
      if (!Number.isNaN(parsed.getTime())) {
        day = String(parsed.getDate()).padStart(2, "0");
        month = String(parsed.getMonth() + 1).padStart(2, "0");
      }
    }
  }

  let hourMinute = "--:--";

  if (rawTime) {
    const timeMatch = rawTime.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, "0");
      const minute = timeMatch[2];
      hourMinute = `${hour}:${minute}`;
    }
  }

  return `${day}-${month} ${hourMinute}`;
}



function isStrikeResult(result) {
  return ["Strike", "Swing", "Foul", "HIT", "Out", "Veld uit", "Strike out"].includes(result);
}

function isOutResult(result) {
  return ["Out", "Veld uit", "Strike out"].includes(result);
}


function getFpsPercentValue(fps, totalBatters) {
  const batters = Number(totalBatters || 0);
  if (!batters) return 0;
  return Math.round((Number(fps || 0) / batters) * 100);
}

function getGoodStatClass(condition) {
  return condition ? " good-stat" : "";
}

function setStatHighlight(elementId, condition) {
  const el = document.getElementById(elementId);
  const stat = el ? el.closest(".stat") : null;
  if (!stat) return;
  stat.classList.toggle("good-stat", Boolean(condition));
}


function getHeatDotClass(result) {
  if (["Ball", "HBP"].includes(result)) return "ball";
  if (["Swing", "Foul"].includes(result)) return "swing-foul";
  if (result === "HIT") return "hit";
  if (isOutResult(result)) return "out";
  return "";
}

function getReadableZone(p) {
  const x = Number(p.x || 50);
  const y = Number(p.y || 50);

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

  let horizontal = "Middle";
  if (relativeX <= 0.25) horizontal = "Inside";
  else if (relativeX >= 0.75) horizontal = "Outside";

  let vertical = "Midden";
  if (relativeY <= 0.25) vertical = "Hoog";
  else if (relativeY >= 0.75) vertical = "Laag";

  if (horizontal === "Middle" && vertical === "Midden") return "Middle-middle";
  return `${vertical} ${horizontal}`;
}


function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = "ogJsonp_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    const script = document.createElement("script");

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout bij laden van Apps Script"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
    }

    window[callbackName] = function(data) {
      cleanup();
      resolve(data);
    };

    script.onerror = function() {
      cleanup();
      reject(new Error("Apps Script kon niet laden"));
    };

    const separator = url.includes("?") ? "&" : "?";
    script.src = url + separator + "callback=" + encodeURIComponent(callbackName) + "&t=" + Date.now();
    document.body.appendChild(script);
  });
}

async function fetchSitePassword() {
  const payload = await loadJsonp(APPS_SCRIPT_URL);
  sitePassword = String((payload && payload.sitePassword) || "").trim();
  return sitePassword;
}

window.verifySitePassword = async function verifySitePassword() {
  const input = document.getElementById("sitePasswordInput");
  const error = document.getElementById("loginError");
  const enteredPassword = String((input && input.value) || "").trim();

  try {
    const correctPassword = await fetchSitePassword();

    if (!correctPassword) {
      if (error) {
        error.textContent = "Geen wachtwoord gevonden in tabblad Wachtwoord cel A1.";
        error.classList.remove("hidden");
      }
      return;
    }

    if (enteredPassword === correctPassword) {
      isAuthenticated = true;
      if (error) error.classList.add("hidden");
      setActiveScreen("homeScreen");
      if (typeof syncFromGoogleSheet === "function") {
        syncFromGoogleSheet().catch(() => {});
      }
      return;
    }

    if (error) {
      error.textContent = "Ongeldig wachtwoord";
      error.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Wachtwoord laden fout:", err);
    if (error) {
      error.textContent = "Wachtwoord kon niet worden geladen";
      error.classList.remove("hidden");
    }
  }
};

function verifySitePassword() {
  return window.verifySitePassword();
}

window.handlePasswordEnter = function handlePasswordEnter(event) {
  if (event.key === "Enter") window.verifySitePassword();
};

function handlePasswordEnter(event) {
  return window.handlePasswordEnter(event);
}

function showHome() {
  if (!isAuthenticated) {
    showLoginScreen();
    return;
  }
  setActiveScreen("homeScreen");
}

function goHomeIfAuthenticated() {
  showHome();
}

// OG Pitching Tracker

function showLoginScreen() {
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  const login = document.getElementById("loginScreen");
  if (login) login.classList.add("active");
}



let savedTeams = {};




function convertTegenstandersRowsToTeams(payload) {
  const teams = {};

  if (!payload) return teams;

  const rows = Array.isArray(payload.tegenstandersRows)
    ? payload.tegenstandersRows
    : [];

  rows.forEach(row => {
    let teamName = "";
    let playerName = "";
    let playerNumber = "";

    if (Array.isArray(row)) {
      teamName = String(row[0] || "").trim();
      playerName = String(row[1] || "").trim();
      playerNumber = String(row[2] || "").trim();
    } else if (row && typeof row === "object") {
      teamName = String(row.Team || row.Tegenstander || row.team || row.tegenstander || "").trim();
      playerName = String(row.Naam || row.Speelster || row.Slagvrouw || row.name || "").trim();
      playerNumber = String(row.Rugnummer || row.Nummer || row.number || "").trim();
    }

    if (!teamName || (!playerName && !playerNumber)) return;

    if (!teams[teamName]) teams[teamName] = [];

    const exists = teams[teamName].some(player =>
      String(player.name || "").toLowerCase() === playerName.toLowerCase() &&
      String(player.number || "") === playerNumber
    );

    if (!exists) {
      teams[teamName].push({
        name: playerName || "Onbekende slagvrouw",
        number: playerNumber || "?"
      });
    }
  });

  return teams;
}

async function loadTeamsFromSheet() {
  try {
    const payload = await loadJsonp(APPS_SCRIPT_URL);
    const rows = Array.isArray(payload?.tegenstandersRows) ? payload.tegenstandersRows : [];

    savedTeams = convertTegenstandersRowsToTeams(payload);

    const teamCount = Object.keys(savedTeams || {}).length;
    if (document.getElementById("teamsScreen")?.classList.contains("active")) {
      setTeamsSyncStatus(`Tegenstanders geladen: ${teamCount} teams, ${rows.length} speelsters.`, "ok");
    }

    return savedTeams;
  } catch (error) {
    console.error("Kon teams niet laden", error);
    setTeamsSyncStatus(`Kon teams niet laden: ${error.message}`, "error");
    return {};
  }
}

async function postTeamMutationToSheet(action, teamName, player = {}, index = null) {
  try {
    const params = new URLSearchParams({
      type: "tegenstander",
      action,
      team: teamName || "",
      name: player.name || "",
      number: player.number || ""
    });

    if (index !== null && index !== undefined) {
      params.set("index", String(index));
    }

    const payload = await loadJsonp(`${APPS_SCRIPT_URL}?${params.toString()}`);
    savedTeams = convertTegenstandersRowsToTeams(payload);

    setTeamsSyncStatus("Tegenstanders opgeslagen en opnieuw geladen.", "ok");
    return true;
  } catch (error) {
    console.error("Kon tegenstander niet opslaan", error);
    setTeamsSyncStatus(`Kon Tegenstanders niet opslaan: ${error.message}`, "error");
    return false;
  }
}

async function saveTeamPlayerToSheet(teamName, player) {
  return postTeamMutationToSheet("add", teamName, player);
}

async function updateTeamPlayerInSheet(teamName, index, player) {
  return postTeamMutationToSheet("update", teamName, player, index);
}

async function removeTeamPlayerFromSheet(teamName, index) {
  return postTeamMutationToSheet("remove", teamName, {}, index);
}





function setTeamsSyncStatus(message, type = "") {
  const status = document.getElementById("teamsSyncStatus");
  if (!status) return;

  status.textContent = message;
  status.className = `sync-status ${type}`;
  status.classList.remove("hidden");
}

function normalizeTeamName(name) {
  return String(name || "").trim();
}

function getTeamPlayers(teamName) {
  const key = normalizeTeamName(teamName);
  return Array.isArray(savedTeams[key]) ? savedTeams[key] : [];
}

async function showTeams() {
  setActiveScreen("teamsScreen");
  setTeamsSyncStatus("Tegenstanders worden geladen...", "loading");
  await loadTeamsFromSheet();
  populateTeamSelect(game.opponent || "");
  renderTeamPlayers();
}

function populateTeamSelect(selectedTeam = "") {
  const select = document.getElementById("teamOpponentSelect");
  if (!select) return;

  const teams = Object.keys(savedTeams || {}).sort((a, b) => a.localeCompare(b));
  const current = normalizeTeamName(selectedTeam);

  select.innerHTML =
    `<option value="">Kies team</option>` +
    teams.map(team => `<option value="${team}">${team}</option>`).join("") +
    `<option value="__new__">+ Team toevoegen</option>`;

  if (current && teams.includes(current)) {
    select.value = current;
    const input = document.getElementById("teamOpponentName");
    const newTeamRow = document.getElementById("newTeamRow");
    if (input) input.value = current;
    if (newTeamRow) newTeamRow.classList.add("hidden");
  } else if (current) {
    select.value = "__new__";
    const input = document.getElementById("teamOpponentName");
    const newTeamRow = document.getElementById("newTeamRow");
    if (input) input.value = current;
    if (newTeamRow) newTeamRow.classList.remove("hidden");
  }
}

function handleTeamSelectChange() {
  const select = document.getElementById("teamOpponentSelect");
  const input = document.getElementById("teamOpponentName");
  const newTeamRow = document.getElementById("newTeamRow");

  if (!select || !input) return;

  if (select.value === "__new__") {
    input.value = "";
    if (newTeamRow) newTeamRow.classList.remove("hidden");
  } else {
    input.value = select.value || "";
    if (newTeamRow) newTeamRow.classList.add("hidden");
  }

  renderTeamPlayers();
}

async function addTeamPlayer() {
  const teamInput = document.getElementById("teamOpponentName");
  const nameInput = document.getElementById("teamPlayerName");
  const numberInput = document.getElementById("teamPlayerNumber");

  const teamName = normalizeTeamName(teamInput?.value);
  const name = String(nameInput?.value || "").trim();
  const number = String(numberInput?.value || "").trim();

  if (!teamName) {
    alert("Vul eerst een team/tegenstander in.");
    return;
  }

  if (!name && !number) {
    alert("Vul minimaal een naam of rugnummer in.");
    return;
  }

  savedTeams[teamName] = getTeamPlayers(teamName);

  const exists = savedTeams[teamName].some(player =>
    String(player.name || "").toLowerCase() === name.toLowerCase() &&
    String(player.number || "") === number
  );

  if (!exists) {
    await saveTeamPlayerToSheet(teamName, {
      name: name || "Onbekende slagvrouw",
      number: number || "?"
    });
  } else {
    setTeamsSyncStatus("Deze speelster bestaat al bij dit team.", "ok");
  }

  populateTeamSelect(teamName);

  if (nameInput) nameInput.value = "";
  if (numberInput) numberInput.value = "";

  renderTeamPlayers();
}

async function removeTeamPlayer(index) {
  const teamName = normalizeTeamName(document.getElementById("teamOpponentName")?.value);
  if (!teamName || !savedTeams[teamName]) return;

  await removeTeamPlayerFromSheet(teamName, index);

  populateTeamSelect(teamName);
  renderTeamPlayers();
}

function renderTeamPlayers() {
  const list = document.getElementById("teamPlayersList");
  const teamName = normalizeTeamName(document.getElementById("teamOpponentName")?.value);

  if (!list) return;

  if (!teamName) {
    list.innerHTML = `<p class="small-note">Vul een team/tegenstander in.</p>`;
    return;
  }

  const players = getTeamPlayers(teamName);

  if (!players.length) {
    list.innerHTML = `<p class="small-note">Nog geen speelsters opgeslagen voor dit team.</p>`;
    return;
  }

  list.innerHTML = players.map((player, index) => `
    <div class="team-player-row">
      <strong>${player.name || "Onbekende slagvrouw"} #${player.number || "?"}</strong>
      <div class="team-player-actions">
        <button class="secondary" onclick="openEditTeamPlayerModal(${index})">Aanpassen</button>
        <button class="secondary" onclick="removeTeamPlayer(${index})">Verwijder</button>
      </div>
    </div>
  `).join("");
}


function openEditTeamPlayerModal(index) {
  const teamName = normalizeTeamName(document.getElementById("teamOpponentName")?.value);
  const player = getTeamPlayers(teamName)[index];

  if (!teamName || !player) {
    alert("Speelster kon niet worden gevonden.");
    return;
  }

  document.getElementById("editTeamPlayerIndex").value = index;
  document.getElementById("editTeamPlayerName").value = player.name || "";
  document.getElementById("editTeamPlayerNumber").value = player.number || "";

  const modal = document.getElementById("editTeamPlayerModal");
  if (modal) modal.classList.remove("hidden");
}

function closeEditTeamPlayerModal() {
  const modal = document.getElementById("editTeamPlayerModal");
  if (modal) modal.classList.add("hidden");
}

async function confirmEditTeamPlayer() {
  const teamName = normalizeTeamName(document.getElementById("teamOpponentName")?.value);
  const index = Number(document.getElementById("editTeamPlayerIndex")?.value);
  const name = String(document.getElementById("editTeamPlayerName")?.value || "").trim();
  const number = String(document.getElementById("editTeamPlayerNumber")?.value || "").trim();

  if (!teamName || Number.isNaN(index) || !savedTeams[teamName] || !savedTeams[teamName][index]) {
    alert("Speelster kon niet worden opgeslagen.");
    return;
  }

  if (!name && !number) {
    alert("Vul minimaal een naam of rugnummer in.");
    return;
  }

  savedTeams[teamName][index] = {
    name: name || "Onbekende slagvrouw",
    number: number || "?"
  };

  await updateTeamPlayerInSheet(teamName, index, {
    name: name || "Onbekende slagvrouw",
    number: number || "?"
  });

  await loadTeamsFromSheet();
  closeEditTeamPlayerModal();
  populateTeamSelect(teamName);
  renderTeamPlayers();
}


function fillSetupFromTeam() {
  const teamName = normalizeTeamName(document.getElementById("teamOpponentName")?.value);
  const players = getTeamPlayers(teamName);

  if (!teamName) {
    alert("Vul eerst een team/tegenstander in.");
    return;
  }

  if (!players.length) {
    alert("Er zijn nog geen speelsters opgeslagen voor dit team.");
    return;
  }

  showSetup();

  populateSetupTeamSelect();

  const setupTeamSelect = document.getElementById("setupTeamSelect");
  const manualRow = document.getElementById("manualOpponentRow");
  const opponentInput = document.getElementById("opponent");

  if (setupTeamSelect) setupTeamSelect.value = teamName;
  if (manualRow) manualRow.classList.add("hidden");
  if (opponentInput) opponentInput.value = teamName;

  fillLineupFromPlayers(players);
}

function openAddBatterModal() {
  const modal = document.getElementById("addBatterModal");
  const select = document.getElementById("addBatterTeamPlayer");
  const nameInput = document.getElementById("addBatterName");
  const numberInput = document.getElementById("addBatterNumber");

  if (!modal || !select) return;

  const players = getTeamPlayers(game.opponent);

  select.innerHTML = `<option value="">Handmatig toevoegen</option>` + players.map((player, index) =>
    `<option value="${index}">${player.name || "Onbekende slagvrouw"} #${player.number || "?"}</option>`
  ).join("");

  if (nameInput) nameInput.value = "";
  if (numberInput) numberInput.value = "";

  modal.classList.remove("hidden");
}

function closeAddBatterModal() {
  const modal = document.getElementById("addBatterModal");
  if (modal) modal.classList.add("hidden");
}

function fillAddBatterFromTeam() {
  const select = document.getElementById("addBatterTeamPlayer");
  const index = Number(select?.value);
  if (Number.isNaN(index)) return;

  const player = getTeamPlayers(game.opponent)[index];
  if (!player) return;

  const nameInput = document.getElementById("addBatterName");
  const numberInput = document.getElementById("addBatterNumber");

  if (nameInput) nameInput.value = player.name || "";
  if (numberInput) numberInput.value = player.number || "";
}

async function confirmAddBatter() {
  const name = String(document.getElementById("addBatterName")?.value || "").trim();
  const number = String(document.getElementById("addBatterNumber")?.value || "").trim();

  if (!name && !number) {
    alert("Vul minimaal een naam of rugnummer in.");
    return;
  }

  game.lineup = game.lineup || [];

  const nextOrder = game.lineup.length
    ? Math.max(...game.lineup.map(player => Number(player.order || 0))) + 1
    : 1;

  game.lineup.push({
    order: nextOrder,
    name: name || `Slagvrouw ${nextOrder}`,
    number: number || "?"
  });

  // Extra toegevoegde speelsters komen op de bench.
  // Alleen slagposities 1 t/m 9 zijn actief totdat je via Wissel slagvrouw iemand inbrengt.
  game.activeLineupSize = 9;

  const teamName = normalizeTeamName(game.opponent);
  if (teamName) {
    savedTeams[teamName] = getTeamPlayers(teamName);
    const exists = savedTeams[teamName].some(player =>
      String(player.name || "").toLowerCase() === String(name || "").toLowerCase() &&
      String(player.number || "") === String(number || "")
    );

    if (!exists) {
      const newPlayer = {
        name: name || `Slagvrouw ${nextOrder}`,
        number: number || "?"
      };

      savedTeams[teamName].push(newPlayer);
      await saveTeamPlayerToSheet(teamName, newPlayer);
    }
  }

  saveLocalGame();
  closeAddBatterModal();
  updateUI();
  setSyncStatus(`Slagvrouw toegevoegd: ${name || `#${number}`}`, "ok");
}


const pitchTypeOptions = ["Fastball", "Slowball", "Overig"];
const resultOptions = ["Ball", "HBP", "Strike", "Swing", "Foul", "HIT", "Veld uit", "Strike out"];

let sheetSyncLoaded = false;
let sheetGames = [];
let selectedOverviewGameId = "";

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


async function showSetup() {
  await loadTeamsFromSheet();
  prepareNewGameForm();
  populateSetupTeamSelect();
  setActiveScreen("setupScreen");
}


function populateSetupTeamSelect() {
  const select = document.getElementById("setupTeamSelect");
  if (!select) return;

  const teams = Object.keys(savedTeams || {}).sort((a, b) => a.localeCompare(b));

  select.innerHTML =
    `<option value="">Kies opgeslagen team</option>` +
    teams.map(team => `<option value="${team}">${team}</option>`).join("") +
    `<option value="__manual__">Handmatig invoeren</option>`;

  select.value = "";
}

function handleSetupTeamSelectChange() {
  const select = document.getElementById("setupTeamSelect");
  const opponentInput = document.getElementById("opponent");
  const manualRow = document.getElementById("manualOpponentRow");
  if (!select || !opponentInput) return;

  if (!select.value || select.value === "__manual__") {
    opponentInput.value = "";
    if (manualRow) manualRow.classList.remove("hidden");
    clearLineupInputs();
    return;
  }

  opponentInput.value = select.value;
  if (manualRow) manualRow.classList.add("hidden");
  fillLineupFromPlayers(getTeamPlayers(select.value));
}

function clearLineupInputs() {
  for (let i = 1; i <= 16; i++) {
    const name = document.getElementById(`name${i}`);
    const num = document.getElementById(`num${i}`);
    if (name) name.value = "";
    if (num) num.value = "";
  }
}

function fillLineupFromPlayers(players) {
  clearLineupInputs();

  (players || []).slice(0, 16).forEach((player, index) => {
    const nameInput = document.getElementById(`name${index + 1}`);
    const numInput = document.getElementById(`num${index + 1}`);

    if (nameInput) nameInput.value = player.name || "";
    if (numInput) numInput.value = player.number || "";
  });
}


function prepareNewGameForm() {
  const setupTeamSelect = document.getElementById("setupTeamSelect");
  const manualRow = document.getElementById("manualOpponentRow");

  if (setupTeamSelect) setupTeamSelect.value = "";
  if (manualRow) manualRow.classList.remove("hidden");

  document.getElementById("opponent").value = "";
  document.getElementById("pitcherName").value = "";
  document.getElementById("gameDate").valueAsDate = new Date();
  document.getElementById("gameTime").value = new Date().toTimeString().slice(0, 5);

  clearLineupInputs();

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
        totalBalls: pitcherPitches.filter(p => ["Ball", "HBP"].includes(p.result)).length,
        totalStrikes: pitcherPitches.filter(p => isStrikeResult(p.result)).length,
        firstPitchStrikes: pitcherPitches.filter(p => p.firstPitch && isStrikeResult(p.result)).length
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

  return pitches.filter(p => isOutResult(p.result)).length;
}

function calculateGameStats(g) {
  const pitches = g.pitches || [];
  const totalPitches = pitches.length;

  const strikes = pitches.filter(p =>
    isStrikeResult(p.result)
  ).length;

  const balls = pitches.filter(p => ["Ball", "HBP"].includes(p.result)).length;
  const outs = getPitcherOutsFromPitches(pitches);

  const fps = pitches.filter(p =>
    p.firstPitch && isStrikeResult(p.result)
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
    strikeouts: countStrikeoutsFromPitches(pitches),
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
    document.getElementById("statsFPSBatters").textContent = "0%";
    setStatHighlight("statsFPSBatters", false);
    setStatHighlight("statsSBRatio", false);
    body.innerHTML = `<tr><td colspan="12">Kies een pitcher.</td></tr>`;
    return;
  }

  const games = getPitcherGames(pitcherName).sort((a, b) => getGameSortValue(b) - getGameSortValue(a));

  if (!games.length) {
    document.getElementById("statsTotalPitches").textContent = "0";
    document.getElementById("statsTotalStrikes").textContent = "0";
    document.getElementById("statsTotalBalls").textContent = "0";
    document.getElementById("statsTotalOuts").textContent = "0";
    document.getElementById("statsTotalIP").textContent = "0.000";
    document.getElementById("statsTotalFPS").textContent = "0";
    document.getElementById("statsSBRatio").textContent = "0.00";
    document.getElementById("statsWalks").textContent = "0";
    document.getElementById("statsFPSBatters").textContent = "0%";
    setStatHighlight("statsFPSBatters", false);
    setStatHighlight("statsSBRatio", false);
    body.innerHTML = `<tr><td colspan="12">Geen games gevonden voor ${pitcherName}.</td></tr>`;
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
  const totalsFpsPercent = getFpsPercentValue(totals.fps, totals.totalBatters);
  document.getElementById("statsFPSBatters").textContent = `${totalsFpsPercent}%`;
  setStatHighlight("statsFPSBatters", totalsFpsPercent > 50);
  setStatHighlight("statsSBRatio", Number(document.getElementById("statsSBRatio").textContent || 0) > 1);

  body.innerHTML = games.map(g => {
    const s = calculateGameStats(g);
    return `
      <tr>
        <td>${formatDateTimeCompact(g.date, g.startTime)}</td>
        <td>${g.opponent || "-"}</td>
        <td>${s.totalPitches}</td>
        <td>${s.strikes}</td>
        <td>${s.balls}</td>
        <td>${s.outs}</td>
        <td>${s.ip}</td>
        <td>${s.fps}</td>
        <td class="${getGoodStatClass(Number(s.sbRatio) > 1)}">${s.sbRatio}</td>
        <td>${s.walks}</td>
        <td>${s.strikeouts || 0}</td>
        <td class="${getGoodStatClass(getFpsPercentValue(s.fps, s.totalBatters) > 50)}">${getFpsPercentValue(s.fps, s.totalBatters)}%</td>
      </tr>
    `;
  }).join("");
}



function showPitcherHeatmaps() {
  setActiveScreen("pitcherHeatmapScreen");
  const status = document.getElementById("pitcherHeatmapUpdated");
  if (status) {
    status.textContent = "Pitcher heatmap wordt geladen...";
    status.className = "sync-status loading";
  }

  syncFromGoogleSheet()
    .catch(() => [])
    .finally(() => {
      populatePitcherHeatmapSelect();
      renderPitcherHeatmap();
    });
}

function getAllPitcherHeatmapPitches() {
  return getStoredGames().flatMap(g => {
    const pitches = Array.isArray(g.pitches) ? g.pitches : [];
    return pitches.map(p => ({
      ...p,
      gameDate: g.date || p.date || "",
      gameOpponent: g.opponent || p.opponent || "",
      gameId: g.gameId || p.gameId || ""
    }));
  }).filter(p => p && p.x != null && p.y != null && p.pitcherName);
}

function populatePitcherHeatmapSelect() {
  const select = document.getElementById("pitcherHeatmapSelect");
  if (!select) return;

  const current = select.value;
  const pitchers = [...new Set(getAllPitcherHeatmapPitches()
    .map(p => String(p.pitcherName || "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  select.innerHTML = `<option value="">Kies pitcher</option>` + pitchers.map(name =>
    `<option value="${name}">${name}</option>`
  ).join("");

  if (pitchers.includes(current)) {
    select.value = current;
  } else if (pitchers.length && !current) {
    select.value = pitchers[0];
  }
}

function setPitcherHeatmapFilter(value) {
  const select = document.getElementById("pitcherHeatmapResultFilter");
  if (select) select.value = value;
  renderPitcherHeatmap();
}

function pitchMatchesHeatmapFilter(p, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "strike") return p.result === "Strike";
  if (filter === "ball") return ["Ball", "HBP"].includes(p.result);
  if (filter === "swingfoul") return ["Swing", "Foul"].includes(p.result);
  if (filter === "hit") return p.result === "HIT";
  if (filter === "out") return isOutResult(p.result);
  return true;
}

function getFilteredPitcherHeatmapPitches() {
  const pitcher = document.getElementById("pitcherHeatmapSelect")?.value || "";
  const filter = document.getElementById("pitcherHeatmapResultFilter")?.value || "all";

  return getAllPitcherHeatmapPitches()
    .filter(p => !pitcher || String(p.pitcherName || "") === pitcher)
    .filter(p => pitchMatchesHeatmapFilter(p, filter));
}

function renderPitcherHeatmap() {
  const selectedPitcher = document.getElementById("pitcherHeatmapSelect")?.value || "";
  const allPitcherPitches = getAllPitcherHeatmapPitches()
    .filter(p => !selectedPitcher || String(p.pitcherName || "") === selectedPitcher);
  const pitches = getFilteredPitcherHeatmapPitches();

  const total = allPitcherPitches.length;
  const strikes = allPitcherPitches.filter(p => isStrikeResult(p.result)).length;
  const balls = allPitcherPitches.filter(p => ["Ball", "HBP"].includes(p.result)).length;

  const totalEl = document.getElementById("pitcherHeatmapTotal");
  const strikePctEl = document.getElementById("pitcherHeatmapStrikePct");
  const ballPctEl = document.getElementById("pitcherHeatmapBallPct");
  const sbEl = document.getElementById("pitcherHeatmapSbRatio");

  if (totalEl) totalEl.textContent = total;
  if (strikePctEl) strikePctEl.textContent = total ? `${Math.round((strikes / total) * 100)}%` : "0%";
  if (ballPctEl) ballPctEl.textContent = total ? `${Math.round((balls / total) * 100)}%` : "0%";
  if (sbEl) sbEl.textContent = balls ? (strikes / balls).toFixed(2) : strikes.toFixed(2);

  drawPitcherDensityHeatmap(pitches);
  renderPitcherZoneGrid(pitches);

  const status = document.getElementById("pitcherHeatmapUpdated");
  if (status) {
    const filterLabel = document.getElementById("pitcherHeatmapResultFilter")?.selectedOptions?.[0]?.textContent || "Alle pitches";
    status.textContent = selectedPitcher
      ? `${filterLabel}: ${pitches.length} pitches getoond voor ${selectedPitcher}.`
      : "Kies een pitcher om de heatmap te tonen.";
    status.className = "sync-status ok";
  }
}

function drawPitcherDensityHeatmap(pitches) {
  const field = document.getElementById("pitcherDensityField");
  const canvas = document.getElementById("pitcherDensityCanvas");
  const zone = document.getElementById("pitcherDensityZone");
  const empty = document.getElementById("pitcherDensityEmpty");
  if (!field || !canvas) return;

  const rect = field.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  if (zone) {
    zone.style.left = `${STRIKE_ZONE.left}%`;
    zone.style.top = `${STRIKE_ZONE.top}%`;
    zone.style.width = `${STRIKE_ZONE.right - STRIKE_ZONE.left}%`;
    zone.style.height = `${STRIKE_ZONE.bottom - STRIKE_ZONE.top}%`;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Donkere basislaag zodat de warme vlekken goed zichtbaar blijven.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "rgba(19,45,77,0.98)");
  bg.addColorStop(1, "rgba(5,7,12,0.98)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (empty) empty.classList.toggle("hidden", Boolean(pitches.length));
  if (!pitches.length) return;

  const gridW = 80;
  const gridH = 80;
  const grid = Array.from({ length: gridH }, () => Array(gridW).fill(0));
  const radius = 5;

  pitches.forEach(p => {
    const gx = Math.round((Number(p.x || 0) / 100) * (gridW - 1));
    const gy = Math.round((Number(p.y || 0) / 100) * (gridH - 1));

    for (let y = Math.max(0, gy - radius); y <= Math.min(gridH - 1, gy + radius); y++) {
      for (let x = Math.max(0, gx - radius); x <= Math.min(gridW - 1, gx + radius); x++) {
        const dx = x - gx;
        const dy = y - gy;
        const distSq = dx * dx + dy * dy;
        const weight = Math.exp(-distSq / 12);
        grid[y][x] += weight;
      }
    }
  });

  const max = Math.max(...grid.flat(), 1);

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const v = grid[y][x] / max;
      if (v < 0.04) continue;

      const px = (x / gridW) * width;
      const py = (y / gridH) * height;
      const cellW = Math.ceil(width / gridW) + 2;
      const cellH = Math.ceil(height / gridH) + 2;

      ctx.fillStyle = getDensityColor(v);
      ctx.globalAlpha = Math.min(0.92, 0.18 + v * 0.82);
      ctx.fillRect(px, py, cellW, cellH);
    }
  }

  ctx.globalAlpha = 1;
}

function getDensityColor(value) {
  if (value < 0.20) return "rgb(37,99,235)";
  if (value < 0.40) return "rgb(56,189,248)";
  if (value < 0.60) return "rgb(250,204,21)";
  if (value < 0.80) return "rgb(249,115,22)";
  return "rgb(239,68,68)";
}

function getPitcherZoneIndex(p) {
  const x = Number(p.x);
  const y = Number(p.y);

  const zoneWidth = STRIKE_ZONE.right - STRIKE_ZONE.left;
  const zoneHeight = STRIKE_ZONE.bottom - STRIKE_ZONE.top;

  const col = Math.min(2, Math.max(0, Math.floor(((x - STRIKE_ZONE.left) / zoneWidth) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(((y - STRIKE_ZONE.top) / zoneHeight) * 3)));

  return row * 3 + col;
}

function renderPitcherZoneGrid(pitches) {
  const grid = document.getElementById("pitcherZoneGrid");
  if (!grid) return;

  const labels = [
    "Hoog Inside", "Hoog Midden", "Hoog Outside",
    "Midden Inside", "Midden Midden", "Midden Outside",
    "Laag Inside", "Laag Midden", "Laag Outside"
  ];

  const zones = labels.map(label => ({
    label,
    total: 0,
    strikes: 0,
    balls: 0
  }));

  pitches.forEach(p => {
    const x = Number(p.x);
    const y = Number(p.y);
    if (
      x < STRIKE_ZONE.left ||
      x > STRIKE_ZONE.right ||
      y < STRIKE_ZONE.top ||
      y > STRIKE_ZONE.bottom
    ) {
      return;
    }

    const index = getPitcherZoneIndex(p);
    zones[index].total += 1;
    if (isStrikeResult(p.result)) zones[index].strikes += 1;
    if (["Ball", "HBP"].includes(p.result)) zones[index].balls += 1;
  });

  const max = Math.max(...zones.map(z => z.total), 1);

  grid.innerHTML = zones.map(zone => {
    const intensity = zone.total / max;
    const strikePct = zone.total ? Math.round((zone.strikes / zone.total) * 100) : 0;
    const className = intensity > 0.66 ? "hot" : intensity > 0.33 ? "warm" : "";
    return `
      <div class="pitcher-zone-cell ${className}">
        <small>${zone.label}</small>
        <strong>${zone.total}</strong>
        <span>${strikePct}% strike</span>
      </div>
    `;
  }).join("");
}

window.addEventListener("resize", () => {
  if (document.getElementById("pitcherHeatmapScreen")?.classList.contains("active")) {
    renderPitcherHeatmap();
  }
});



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
    document.getElementById("batterSearchAverage").textContent = ".000";
    body.innerHTML = `<tr><td colspan="7">Kies een tegenstander en slagvrouw.</td></tr>`;
    return;
  }

  const [selectedName, selectedNumber] = selectedPlayer.split("|");

  const matches = getAllPitchesFromStoredGames().filter(p => {
    return p.gameOpponent === selectedOpponent &&
      String(p.batterName || "") === selectedName &&
      String(p.batterNumber || "") === selectedNumber;
  });

  const hits = matches.filter(p => p.result === "HIT").length;
  const outs = matches.filter(p => isOutResult(p.result)).length;
  const balls = matches.filter(p => ["Ball", "HBP"].includes(p.result)).length;
  const strikes = matches.filter(p => isStrikeResult(p.result)).length;
  const games = new Set(matches.map(p => p.gameId || `${p.gameDate}-${p.gameOpponent}`)).size;

  const battingAverage =
    ((hits + outs) > 0 ? (hits / (hits + outs)) : 0);

  document.getElementById("batterSearchPitches").textContent = matches.length;
  document.getElementById("batterSearchHits").textContent = hits;
  document.getElementById("batterSearchOuts").textContent = outs;
  document.getElementById("batterSearchAverage").textContent = battingAverage;
  document.getElementById("batterSearchBalls").textContent = balls;
  document.getElementById("batterSearchStrikes").textContent = strikes;
  document.getElementById("batterSearchGames").textContent = matches.length ? games : 0;

  matches.forEach((p, index) => {
    if (!heatmap || p.x == null || p.y == null) return;

    const dot = document.createElement("div");
    dot.className = "heat-dot";
    const heatClass = getHeatDotClass(p.result);
    if (heatClass) dot.classList.add(heatClass);
    dot.style.left = `${p.x}%`;
    dot.style.top = `${p.y}%`;
    dot.title = `${p.batterName} #${p.batterNumber} · ${p.pitcherName || "Pitcher onbekend"} · ${p.pitchType} · ${p.result} · ${getReadableZone(p)}`;
    dot.textContent = index + 1;
    heatmap.appendChild(dot);
  });

  if (!matches.length) {
    body.innerHTML = `<tr><td colspan="7">Geen pitches gevonden.</td></tr>`;
    return;
  }

  body.innerHTML = matches
    .map((p, index) => ({ ...p, heatmapNumber: index + 1 }))
    .slice()
    .reverse()
    .map(p => `
      <tr>
        <td>${p.heatmapNumber}</td>
        <td>${formatDateTimeCompact(p.gameDate, p.startTime)}</td>
        <td>${p.gameOpponent || "-"}</td>
        <td>${p.pitcherName || "-"}</td>
        <td>${p.pitchType || "-"}</td>
        <td>${p.result || "-"}</td>
        <td>${getReadableZone(p)}</td>
      </tr>
    `).join("");
}


// Backwards compatible oude naam



function getSelectedSetupTeamName() {
  const select = document.getElementById("setupTeamSelect");
  const opponentInput = document.getElementById("opponent");

  if (select && select.value && select.value !== "__manual__") return select.value;
  return normalizeTeamName(opponentInput?.value);
}

function openLineupPicker(slot) {
  const select = document.getElementById("lineupPickerSelect");
  const modal = document.getElementById("lineupPickerModal");
  const slotInput = document.getElementById("lineupPickerSlot");
  const meta = document.getElementById("lineupPickerMeta");

  if (!select || !modal || !slotInput) return;

  const teamName = getSelectedSetupTeamName();
  const players = getTeamPlayers(teamName);

  if (!teamName || !players.length) {
    alert("Kies eerst een opgeslagen team met speelsters.");
    return;
  }

  const usedKeys = new Set();
  for (let i = 1; i <= 16; i++) {
    if (i === Number(slot)) continue;
    const name = String(document.getElementById(`name${i}`)?.value || "").trim();
    const number = String(document.getElementById(`num${i}`)?.value || "").trim();
    if (name || number) usedKeys.add(`${name}|${number}`);
  }

  slotInput.value = slot;
  if (meta) meta.textContent = `Positie ${slot} · ${teamName}`;

  select.innerHTML = `<option value="">Kies speelster</option>` + players.map((player, index) => {
    const key = `${player.name || ""}|${player.number || ""}`;
    const disabled = usedKeys.has(key) ? " disabled" : "";
    const suffix = usedKeys.has(key) ? " (al gekozen)" : "";
    return `<option value="${index}"${disabled}>${player.name || "Onbekende slagvrouw"} #${player.number || "?"}${suffix}</option>`;
  }).join("");

  const currentName = String(document.getElementById(`name${slot}`)?.value || "").trim();
  const currentNumber = String(document.getElementById(`num${slot}`)?.value || "").trim();
  const currentIndex = players.findIndex(player =>
    String(player.name || "") === currentName &&
    String(player.number || "") === currentNumber
  );

  if (currentIndex >= 0) select.value = String(currentIndex);

  modal.classList.remove("hidden");
}

function closeLineupPicker() {
  const modal = document.getElementById("lineupPickerModal");
  if (modal) modal.classList.add("hidden");
}

function confirmLineupPicker() {
  const slot = Number(document.getElementById("lineupPickerSlot")?.value);
  const selectedIndex = Number(document.getElementById("lineupPickerSelect")?.value);
  const teamName = getSelectedSetupTeamName();
  const player = getTeamPlayers(teamName)[selectedIndex];

  if (!slot || Number.isNaN(selectedIndex) || !player) {
    alert("Kies eerst een speelster.");
    return;
  }

  const nameInput = document.getElementById(`name${slot}`);
  const numInput = document.getElementById(`num${slot}`);

  if (nameInput) nameInput.value = player.name || "";
  if (numInput) numInput.value = player.number || "";

  closeLineupPicker();
}


function renderLineupRows() {
  const holder = document.getElementById("lineupRows");
  if (!holder) return;

  holder.innerHTML = "";
  for (let i = 1; i <= 16; i++) {
    holder.innerHTML += `
      <div class="lineup-row lineup-row-selectable">
        <button type="button" class="spot lineup-spot-button" onclick="openLineupPicker(${i})">${i}</button>
        <input id="name${i}" placeholder="${i <= 9 ? 'Naam slagvrouw' : 'Bench speler'}" onclick="openLineupPicker(${i})" readonly />
        <input id="num${i}" placeholder="#" onclick="openLineupPicker(${i})" readonly />
      </div>
    `;
  }
}

function fillDemoLineup() {
  if (!document.getElementById("name1")) {
    renderLineupRows();
  }

  const names = ["Emma", "Noor", "Lisa", "Sanne", "Mila", "Roos", "Tess", "Lotte", "Fleur", "Jade", "Isa", "Liv", "Zoë", "Nova", "Evi", "Sara"];
  const numbers = [12, 7, 21, 4, 18, 10, 3, 25, 9, 14, 6, 31, 22, 11, 15, 28];

  names.forEach((name, index) => {
    const nameInput = document.getElementById(`name${index + 1}`);
    const numInput = document.getElementById(`num${index + 1}`);

    if (nameInput) nameInput.value = name;
    if (numInput) numInput.value = numbers[index];
  });

  const opponentInput = document.getElementById("opponent");
  if (opponentInput) opponentInput.value = "Demo Team";
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

  let games = getStoredGames()
    .filter(g => Boolean(g.closed))
    .map(g => {
      const pitches = g.pitches || [];
      const stats = calculateGameStats({ ...g, pitches });
      const pitchers = [...new Set(pitches.map(p => p.pitcherName).filter(Boolean))];
      const hits = pitches.filter(p => p.result === "HIT").length;
      const fpsPercent = stats.totalBatters === 0 ? "0%" : `${Math.round((stats.fps / stats.totalBatters) * 100)}%`;

      return {
        ...g,
        date: g.date || "",
        startTime: g.startTime || "",
        opponent: g.opponent || "Onbekende tegenstander",
        pitchers,
        totalPitches: stats.totalPitches,
        strikes: stats.strikes,
        balls: stats.balls,
        outs: stats.outs,
        ip: stats.ip,
        fpsPercent,
        walks: stats.walks,
        hits
      };
    });

  if (query) {
    games = games.filter(g =>
      String(g.date).toLowerCase().includes(query) ||
      String(g.opponent).toLowerCase().includes(query) ||
      String(g.startTime).toLowerCase().includes(query) ||
      g.pitchers.some(p => String(p).toLowerCase().includes(query))
    );
  }

  games.sort((a, b) => getGameSortValue(b) - getGameSortValue(a));

  if (!games.length) {
    list.innerHTML = `<p class="small-note">Geen afgesloten games gevonden.</p>`;
    return;
  }

  list.innerHTML = games.map(g => `
    <button class="game-list-button" onclick="showPreviousGameOverview('${g.gameId}')">
      <strong>${g.opponent}</strong>
      <small>${formatDateTimeCompact(g.date, g.startTime)} · ${g.pitchers.join(", ") || "Pitcher onbekend"}</small>
      <div class="game-meta-row">
        <div class="game-meta-pill">${g.totalPitches} P</div>
        <div class="game-meta-pill">${g.strikes} S</div>
        <div class="game-meta-pill">${g.balls} B</div>
        <div class="game-meta-pill">${g.outs} Outs</div>
        <div class="game-meta-pill">${g.ip} IP</div>
        <div class="game-meta-pill${getGoodStatClass(Number(String(g.fpsPercent).replace("%", "")) > 50)}">FPS ${g.fpsPercent}</div>
      </div>
    </button>
  `).join("");
}



function countStrikeoutsFromPitches(pitches) {
  let balls = 0;
  let strikes = 0;
  let strikeouts = 0;

  (pitches || []).slice().reverse().forEach(p => {
    if (p.firstPitch) {
      balls = 0;
      strikes = 0;
    }

    if (p.result === "Strike out") {
      strikeouts += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (["Ball", "HBP"].includes(p.result)) balls += 1;
    if (["Strike", "Swing"].includes(p.result)) strikes += 1;
    if (p.result === "Foul" && strikes < 2) strikes += 1;

    // Derde Strike of derde Swing telt als strikeout.
    if (strikes >= 3) {
      strikeouts += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (p.walk || balls >= 4 || ["HBP", "HIT", "Out", "Veld uit"].includes(p.result)) {
      balls = 0;
      strikes = 0;
    }
  });

  return strikeouts;
}

function getGameSortValue(g) {
  const date = String(g.date || "").trim();
  const time = String(g.startTime || "00:00").trim() || "00:00";

  const isIsoDateTime = /T\d{2}:\d{2}:\d{2}/.test(date);
  if (isIsoDateTime) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }

  const isoMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/(\d{1,2}):(\d{2})/);

  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const hour = timeMatch ? Number(timeMatch[1]) : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;
    return new Date(year, month, day, hour, minute).getTime();
  }

  const value = Date.parse(`${date}T${time}`);
  if (!Number.isNaN(value)) return value;

  const fallback = Date.parse(g.closedAt || g.startedAt || "");
  return Number.isNaN(fallback) ? 0 : fallback;
}

function getResultBreakdown(pitches) {
  const baseResults = resultOptions.map(result => ({
    result,
    count: pitches.filter(p => p.result === result).length
  }));

  baseResults.push({
    result: "Walks",
    count: countWalks({ pitches })
  });

  baseResults.push({
    result: "Strikeouts",
    count: countStrikeoutsFromPitches(pitches)
  });

  return baseResults.filter(item => item.count > 0);
}

function showPreviousGameOverview(gameId) {
  selectedOverviewGameId = gameId;
  const selected = getStoredGames().find(g => g.gameId === gameId);

  if (!selected) {
    alert("Deze game kon niet worden geladen.");
    return;
  }

  const pitches = selected.pitches || [];
  const stats = calculateGameStats({ ...selected, pitches });
  const hits = pitches.filter(p => p.result === "HIT").length;
  const fpsPercent = stats.totalBatters === 0 ? "0%" : `${Math.round((stats.fps / stats.totalBatters) * 100)}%`;

  document.getElementById("overviewGameTitle").textContent = selected.opponent || "Onbekende tegenstander";
  document.getElementById("overviewGameMeta").textContent =
    `${formatDateTimeCompact(selected.date, selected.startTime)} · ${pitches.length} pitches`;

  document.getElementById("overviewTotalPitches").textContent = stats.totalPitches;
  document.getElementById("overviewTotalStrikes").textContent = stats.strikes;
  document.getElementById("overviewTotalBalls").textContent = stats.balls;
  document.getElementById("overviewTotalOuts").textContent = stats.outs;
  document.getElementById("overviewTotalIP").textContent = stats.ip;
  document.getElementById("overviewFPSPercent").textContent = fpsPercent;
  setStatHighlight("overviewFPSPercent", Number(String(fpsPercent).replace("%", "")) > 50);
  document.getElementById("overviewHits").textContent = hits;
  document.getElementById("overviewWalks").textContent = stats.walks;
  document.getElementById("overviewSBRatio").textContent = stats.sbRatio;
  setStatHighlight("overviewSBRatio", Number(stats.sbRatio) > 1);

  const pitchers = [...new Set(pitches.map(p => p.pitcherName).filter(Boolean))];
  const pitchersList = document.getElementById("overviewPitchersList");

  pitchersList.innerHTML = pitchers.length
    ? pitchers.map(pitcherName => {
        const pitcherPitches = pitches.filter(p => p.pitcherName === pitcherName);
        const pitcherStats = calculateGameStats({ ...selected, pitches: pitcherPitches });
        const pitcherFpsPercent = pitcherStats.totalBatters === 0
          ? "0%"
          : `${Math.round((pitcherStats.fps / pitcherStats.totalBatters) * 100)}%`;

        return `
          <div class="overview-row${getGoodStatClass(Number(String(pitcherFpsPercent).replace("%", "")) > 50 || Number(pitcherStats.sbRatio) > 1)}">
            <strong>${pitcherName}</strong>
            <span>${pitcherStats.totalPitches} P · ${pitcherStats.strikes} S · ${pitcherStats.balls} B · ${pitcherStats.outs} Outs · ${pitcherStats.ip} IP · FPS ${pitcherFpsPercent} · S/B ${pitcherStats.sbRatio}</span>
          </div>
        `;
      }).join("")
    : `<p class="small-note">Geen pitchers gevonden.</p>`;

  const resultsList = document.getElementById("overviewResultsList");
  const breakdown = getResultBreakdown(pitches);

  resultsList.innerHTML = breakdown.length
    ? breakdown.map(item => `
        <div class="overview-row compact">
          <strong>${item.result}</strong>
          <span>${item.count}</span>
        </div>
      `).join("")
    : `<p class="small-note">Geen resultaten gevonden.</p>`;

  setActiveScreen("previousGameOverviewScreen");
}

function editOverviewGame() {
  if (!selectedOverviewGameId) {
    alert("Geen game geselecteerd.");
    return;
  }
  loadArchivedGame(selectedOverviewGameId);
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

  if (isFirstPitch && isStrikeResult(game.result)) {
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

  if (result === "HBP") {
    game.balls += 1;
    game.totalBalls += 1;
    nextBatter(false);
    return;
  }

  if (["Strike", "Swing"].includes(result)) {
    game.strikes += 1;
    game.totalStrikes += 1;
  }

  if (result === "Foul" && game.strikes < 2) {
    game.strikes += 1;
    game.totalStrikes += 1;
  }

  if (result === "HIT") {
    game.strikes += 1;
    game.totalStrikes += 1;
    nextBatter(false);
    return;
  }

  if (result === "Veld uit") {
    game.strikes += 1;
    game.totalStrikes += 1;
    addOut(false);
    nextBatter(false);
    return;
  }

  if (result === "Strike out") {
    game.strikes += 1;
    game.totalStrikes += 1;
    addOut(false);
    nextBatter(false);
    return;
  }

  if (game.balls >= 4) {
    nextBatter(false);
    return;
  }

  if (game.strikes >= 3) {
    addOut(false);
    nextBatter(false);
  }
}


function previousBatter(shouldSave = true) {
  const lineupSize = Math.min(Number(game.activeLineupSize || 9), 9);
  game.batterIndex = (game.batterIndex - 1 + lineupSize) % lineupSize;
  resetCount(false);
  game.pitchLocation = null;

  const dot = document.querySelector(".pitch-dot");
  if (dot) dot.remove();

  if (shouldSave) saveLocalGame();
  updateUI();
}

function nextBatter(shouldSave = true) {
  game.batterIndex = (game.batterIndex + 1) % Math.min(Number(game.activeLineupSize || 9), 9);
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

  const activePlayers = game.lineup.filter(player => Number(player.order) <= 9);
  const benchPlayers = game.lineup.filter(player => Number(player.order) > 9);

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
    const heatClass = getHeatDotClass(p.result);
    if (heatClass) dot.classList.add(heatClass);
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
  return (Number(totalOuts || 0) / 3).toFixed(3).replace(/^0/, '');
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
        firstPitchStrike: pitch.firstPitch && isStrikeResult(pitch.result),
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
  const activeGame = (typeof game !== "undefined" && game && game.gameId && !game.closed) ? [game] : [];
  const ids = new Set(activeGame.map(g => g.gameId));
  const sheetList = Array.isArray(sheetGames) ? sheetGames : [];
  return [...activeGame, ...sheetList.filter(g => !ids.has(g.gameId))];
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
  const activeGame = (typeof game !== "undefined" && game && game.gameId && !game.closed) ? [game] : [];
  const activeIds = new Set(activeGame.map(g => g.gameId));
  const sheetList = Array.isArray(sheetGamesFromServer) ? sheetGamesFromServer : [];
  return [...activeGame, ...sheetList.filter(g => !activeIds.has(g.gameId))];
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


