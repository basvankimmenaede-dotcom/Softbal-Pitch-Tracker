const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxSWylAxHQA5Efq8ngkLNBfXYX27RDf1YIoiXcGHEJyQXZ-lnSMbxuqQwCunz1lVm-C_w/exec";
let sitePassword = "";
let isAuthenticated = false;



/* === Offline-first sync naar Google Sheets === */
const OFFLINE_DB_NAME = "ogPitchingTrackerOffline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_STORE_NAME = "syncQueue";
const OFFLINE_RETRY_INTERVAL_MS = 30000;

let offlineDbPromise = null;
let offlineSyncInProgress = false;
let offlineRetryTimer = null;

function getOfflineItemId(prefix = "queue") {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openOfflineDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (offlineDbPromise) return offlineDbPromise;

  offlineDbPromise = new Promise(resolve => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        const store = db.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error("IndexedDB openen mislukt", request.error);
      resolve(null);
    };
  });

  return offlineDbPromise;
}

function getFallbackQueue() {
  try {
    return JSON.parse(localStorage.getItem("ogOfflineSyncQueue") || "[]");
  } catch (error) {
    return [];
  }
}

function setFallbackQueue(items) {
  try {
    localStorage.setItem("ogOfflineSyncQueue", JSON.stringify(items || []));
  } catch (error) {
    console.error("Fallback queue opslaan mislukt", error);
  }
}

async function addToOfflineQueue(type, payload) {
  const item = {
    id: getOfflineItemId(type),
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: ""
  };

  const db = await openOfflineDb();

  if (!db) {
    const items = getFallbackQueue();
    items.push(item);
    setFallbackQueue(items);
    await updateOfflineSyncStatus();
    return item.id;
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, "readwrite");
    tx.objectStore(OFFLINE_STORE_NAME).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  await updateOfflineSyncStatus();
  return item.id;
}

async function getOfflineQueueItems() {
  const db = await openOfflineDb();

  if (!db) {
    return getFallbackQueue();
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, "readonly");
    const request = tx.objectStore(OFFLINE_STORE_NAME).getAll();

    request.onsuccess = () => {
      const items = Array.isArray(request.result) ? request.result : [];
      items.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      resolve(items);
    };

    request.onerror = () => reject(request.error);
  });
}

async function removeOfflineQueueItem(id) {
  const db = await openOfflineDb();

  if (!db) {
    const items = getFallbackQueue().filter(item => item.id !== id);
    setFallbackQueue(items);
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, "readwrite");
    tx.objectStore(OFFLINE_STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function updateOfflineQueueItem(item) {
  const db = await openOfflineDb();

  if (!db) {
    const items = getFallbackQueue();
    const index = items.findIndex(existing => existing.id === item.id);
    if (index >= 0) items[index] = item;
    setFallbackQueue(items);
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, "readwrite");
    tx.objectStore(OFFLINE_STORE_NAME).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getOfflineQueueCount() {
  const items = await getOfflineQueueItems();
  return items.length;
}

async function postPayloadToGoogleSheet(payload) {
  if (!APPS_SCRIPT_URL) throw new Error("Google Sheets niet gekoppeld");
  if (navigator.onLine === false) throw new Error("Offline");

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
}

async function queueGoogleSheetPayload(type, payload, successMessage = "Item") {
  await addToOfflineQueue(type, payload);
  await syncOfflineQueue(false);

  const remaining = await getOfflineQueueCount();
  if (remaining === 0) {
    setSyncStatus(`${successMessage} gesynchroniseerd met Google Sheets.`, "ok");
  } else {
    setSyncStatus(`${successMessage} lokaal opgeslagen. ${remaining} item(s) wachten op sync.`, navigator.onLine === false ? "error" : "loading");
  }

  await updateOfflineSyncStatus();
}

async function syncOfflineQueue(showDoneMessage = true) {
  if (offlineSyncInProgress) return;
  offlineSyncInProgress = true;

  try {
    const items = await getOfflineQueueItems();

    if (!items.length) {
      if (showDoneMessage) setSyncStatus("Alles is gesynchroniseerd.", "ok");
      await updateOfflineSyncStatus();
      return;
    }

    if (navigator.onLine === false) {
      await updateOfflineSyncStatus();
      return;
    }

    for (const item of items) {
      try {
        await postPayloadToGoogleSheet(item.payload);
        await removeOfflineQueueItem(item.id);
      } catch (error) {
        item.attempts = Number(item.attempts || 0) + 1;
        item.lastError = String(error.message || error);
        item.lastAttemptAt = new Date().toISOString();
        await updateOfflineQueueItem(item);
        break;
      }
    }

    const remaining = await getOfflineQueueCount();
    if (remaining === 0) {
      if (showDoneMessage) setSyncStatus("Alles is gesynchroniseerd.", "ok");
    } else {
      setSyncStatus(`${remaining} item(s) wachten nog op sync.`, navigator.onLine === false ? "error" : "loading");
    }

    await updateOfflineSyncStatus();
  } finally {
    offlineSyncInProgress = false;
  }
}

async function updateOfflineSyncStatus() {
  let count = 0;
  try {
    count = await getOfflineQueueCount();
  } catch (error) {
    count = 0;
  }

  const isOnline = navigator.onLine !== false;
  const message = count > 0
    ? `${isOnline ? "Online" : "Offline"} – ${count} item(s) wachten op sync`
    : `${isOnline ? "Online" : "Offline"} – alles gesynchroniseerd`;

  const type = count > 0 ? (isOnline ? "loading" : "error") : "ok";

  document.querySelectorAll(".offline-sync-status").forEach(el => {
    el.textContent = message;
    el.className = `offline-sync-status sync-status ${type}`;
    el.classList.remove("hidden");
  });
}

function startOfflineAutoRetry() {
  if (offlineRetryTimer) clearInterval(offlineRetryTimer);

  offlineRetryTimer = setInterval(() => {
    syncOfflineQueue(false).catch(error => console.error("Auto sync mislukt", error));
  }, OFFLINE_RETRY_INTERVAL_MS);

  window.addEventListener("online", () => {
    updateOfflineSyncStatus();
    syncOfflineQueue(true).catch(error => console.error("Online sync mislukt", error));
  });

  window.addEventListener("offline", () => {
    updateOfflineSyncStatus();
  });

  updateOfflineSyncStatus();
  syncOfflineQueue(false).catch(error => console.error("Start sync mislukt", error));
}


const STRIKE_ZONE = {
  left: 54,
  right: 92,
  top: 18,
  bottom: 72
};

function getDisplayPitchBounds(mode = "standard") {
  // Alle pitches blijven opgeslagen als 0-100.
  // Standard gebruikt exact die ruimte.
  // Wide geeft extra buitenruimte voor density heatmaps, zonder de strikezone verhouding te veranderen.
  if (mode === "wide") {
    return { minX: -8, maxX: 108, minY: -4, maxY: 106 };
  }

  return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
}

function toDisplayPercent(value, min, max) {
  return ((Number(value) - min) / (max - min)) * 100;
}

function applyStrikeZoneToElement(element, mode = "standard") {
  if (!element) return;

  const bounds = getDisplayPitchBounds(mode);
  element.style.left = `${toDisplayPercent(STRIKE_ZONE.left, bounds.minX, bounds.maxX)}%`;
  element.style.top = `${toDisplayPercent(STRIKE_ZONE.top, bounds.minY, bounds.maxY)}%`;
  element.style.width = `${((STRIKE_ZONE.right - STRIKE_ZONE.left) / (bounds.maxX - bounds.minX)) * 100}%`;
  element.style.height = `${((STRIKE_ZONE.bottom - STRIKE_ZONE.top) / (bounds.maxY - bounds.minY)) * 100}%`;
}

function applyAllStrikeZoneLayouts() {
  document.querySelectorAll(".zone").forEach(zone => applyStrikeZoneToElement(zone, "standard"));
  document.querySelectorAll(".heatmap-zone").forEach(zone => applyStrikeZoneToElement(zone, "standard"));

  const densityZone = document.getElementById("pitcherDensityZone");
  if (densityZone) applyStrikeZoneToElement(densityZone, "standard");
}

function getDisplayPoint(point, mode = "standard") {
  const bounds = getDisplayPitchBounds(mode);

  return {
    x: toDisplayPercent(Number(point.x || 0), bounds.minX, bounds.maxX),
    y: toDisplayPercent(Number(point.y || 0), bounds.minY, bounds.maxY)
  };
}



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
  const clean = String(result || "").trim().toLowerCase();
  return [
    "out",
    "veld uit",
    "velduit",
    "field out",
    "strike out",
    "strikeout",
    "strike-out"
  ].includes(clean);
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


function setTextIfExists(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = value;
}


function getHeatDotClass(result) {
  if (["Ball", "HBP"].includes(result)) return "ball";
  if (result === "Strike") return "strike";
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
  bindBattedBallModalEvents();
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
const resultOptions = ["Ball", "HBP", "Strike", "Swing", "Foul", "HIT", "Veld uit"];

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
  batterCounts: {},
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
  startOfflineAutoRetry();
  applyAllStrikeZoneLayouts();
  bindBattedBallModalEvents();
}

function setActiveScreen(screenId) {
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
  applyAllStrikeZoneLayouts();
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
    teams.map(team => `<option value="${team}">${team}</option>`).join("");

  select.value = "";
}

function handleSetupTeamSelectChange() {
  const select = document.getElementById("setupTeamSelect");
  const opponentInput = document.getElementById("opponent");
  const manualRow = document.getElementById("manualOpponentRow");
  if (!select || !opponentInput) return;

  if (!select.value) {
    opponentInput.value = "";
    if (manualRow) manualRow.classList.add("hidden");
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
  if (manualRow) manualRow.classList.add("hidden");

  document.getElementById("opponent").value = "";
  document.getElementById("pitcherName").value = "";
  document.getElementById("gameDate").valueAsDate = new Date();
  document.getElementById("gameTime").value = new Date().toTimeString().slice(0, 5);

  clearLineupInputs();

  setSyncStatus("Online - alles gesynchroniseerd.", "ok");
}

function showPlaceholder(title) {
  document.getElementById("placeholderTitle").textContent = title;
  setActiveScreen("placeholderScreen");
}


let selectedSpeedPitchType = "Fastball";

function getDefaultSpeedPitchTypes() {
  return ["Fastball", "Slowball", "Curveball"];
}

function getSpeedPitchTypesForPitcher(pitcherName, includeDefaults = true) {
  const types = new Set(includeDefaults ? getDefaultSpeedPitchTypes() : []);

  getStoredSpeedTrainings()
    .filter(item => !pitcherName || String(item.pitcherName || "") === String(pitcherName || ""))
    .forEach(item => {
      const type = normalizeSpeedPitchType(item.pitchType || "");
      if (type) types.add(type);
    });

  const preferredOrder = ["Fastball", "Slowball", "Change-up", "Riseball", "Dropball", "Curveball", "Screwball", "Effectball"];

  return [...types].sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    return a.localeCompare(b);
  });
}

function getPitchTypeShortLabel(type) {
  const clean = String(type || "").trim();
  if (!clean) return "?";

  const known = {
    Fastball: "FB",
    Slowball: "SB",
    Curveball: "CB",
    "Change-up": "CH",
    Changeup: "CH",
    Riseball: "RB",
    Dropball: "DB",
    Screwball: "SC",
    Effectball: "EF"
  };

  if (known[clean]) return known[clean];

  const words = clean.split(/\s+|-/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function renderSpeedPitchTypeButtons() {
  const holder = document.getElementById("speedPitchTypes");
  const pitcherName = document.getElementById("speedTrainingPitcher")?.value || document.getElementById("statsPitcherName")?.value || "";
  if (!holder) return;

  const types = getSpeedPitchTypesForPitcher(pitcherName, true);
  if (!types.includes(selectedSpeedPitchType) && selectedSpeedPitchType !== "__custom__") {
    selectedSpeedPitchType = types[0] || "Fastball";
  }

  holder.innerHTML = types.map(type => `
    <button type="button" class="secondary ${selectedSpeedPitchType === type ? "selected" : ""}" onclick="selectSpeedPitchType('${type.replace(/'/g, "\\'")}')">${type}</button>
  `).join("") + `<button type="button" class="secondary ${selectedSpeedPitchType === "__custom__" ? "selected" : ""}" onclick="selectSpeedPitchType('__custom__')">+ Ander</button>`;

  const customRow = document.getElementById("customSpeedPitchTypeRow");
  if (customRow) customRow.classList.toggle("hidden", selectedSpeedPitchType !== "__custom__");
}


function clearLocalSpeedTrainingCache() {
  localStorage.removeItem("ogSpeedTrainings");
  renderPitcherSpeedOverview();
}

function getStoredSpeedTrainings() {
  try {
    return JSON.parse(localStorage.getItem("ogSpeedTrainings") || "[]");
  } catch (error) {
    return [];
  }
}

function saveStoredSpeedTrainings(items) {
  localStorage.setItem("ogSpeedTrainings", JSON.stringify(items || []));
}

function getSpeedTrainingKey(item) {
  return [
    item.id || "",
    item.date || "",
    item.pitcherName || "",
    item.pitchType || "",
    item.speed || "",
    item.createdAt || ""
  ].join("|");
}

function mergeSpeedTrainings(localItems, sheetItems) {
  const merged = new Map();

  [...(localItems || []), ...(sheetItems || [])].forEach(item => {
    if (!item) return;
    const normalized = {
      id: item.id || `speed-${item.date || ""}-${item.pitcherName || ""}-${item.pitchType || ""}-${item.speed || ""}-${item.createdAt || ""}`,
      pitcherName: item.pitcherName || "",
      date: item.date || "",
      pitchType: normalizeSpeedPitchType(item.pitchType || "Fastball"),
      speed: Number(item.speed || 0),
      unit: item.unit || "mph",
      createdAt: item.createdAt || item.timestamp || new Date().toISOString()
    };

    if (!normalized.pitcherName || !normalized.date || !normalized.pitchType || !Number.isFinite(normalized.speed) || normalized.speed <= 0) return;

    merged.set(getSpeedTrainingKey(normalized), normalized);
  });

  return [...merged.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function convertSheetRowsToSpeedTrainings(payload) {
  if (!payload || !payload.speedTrainingRows || !payload.speedTrainingRows.length) return [];

  const headers = payload.speedTrainingHeaders || [];
  const rows = payload.speedTrainingRows;

  const records = rows.map(row => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || "").trim()] = row[index];
      record[`_${index}`] = row[index];
    });
    return record;
  });

  const get = (record, names, fallbackIndex = null) => {
    for (const name of names) {
      if (record[name] !== undefined && record[name] !== "") return record[name];
    }
    if (fallbackIndex !== null) return record[`_${fallbackIndex}`];
    return "";
  };

  const normalizeHeaderKey = value =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const getLoose = (record, names) => {
    const wanted = names.map(normalizeHeaderKey);

    for (const key of Object.keys(record)) {
      if (key.startsWith("_")) continue;
      if (wanted.includes(normalizeHeaderKey(key)) && record[key] !== undefined && record[key] !== "") {
        return record[key];
      }
    }

    return "";
  };

  return records.map(record => {
    const rowType = String(get(record, ["Row Type", "type"], 0) || "").trim();
    if (rowType && rowType !== "speed_training") return null;

    return {
      id: String(get(record, ["ID", "id"], 1) || "").trim(),
      date: String(get(record, ["Datum", "date"], 2) || "").trim(),
      pitcherName: String(get(record, ["Pitcher", "pitcherName"], 3) || "").trim(),
      pitchType: normalizeSpeedPitchType(get(record, ["Pitch Type", "pitchType"], 4)),
      speed: Number(get(record, ["Speed MPH", "speed", "speedMph"], 5)),
      unit: String(get(record, ["Unit", "unit"], 6) || "mph").trim() || "mph",
      createdAt: String(get(record, ["Timestamp", "createdAt"], 7) || "").trim()
    };
  }).filter(item => item && item.pitcherName && item.date && item.pitchType && Number.isFinite(item.speed) && item.speed > 0);
}

async function sendSpeedTrainingToGoogleSheet(item) {
  if (!APPS_SCRIPT_URL) {
    setSyncStatus("Google Sheets niet gekoppeld.", "error");
    return;
  }

  const payload = {
    type: "speed_training",
    id: item.id,
    date: item.date,
    pitcherName: item.pitcherName,
    pitchType: item.pitchType,
    speed: item.speed,
    unit: "mph",
    createdAt: item.createdAt || new Date().toISOString()
  };

  await queueGoogleSheetPayload("speed_training", payload, "Speed training");
}

async function syncSpeedTrainingFromGoogleSheet(payloadFromSheet = null) {
  try {
    const payload = payloadFromSheet || await loadSheetDataJsonp();
    const sheetItems = convertSheetRowsToSpeedTrainings(payload);

    // SpeedTraining in Google Sheets is leidend.
    // Hiermee voorkom je dat oude localStorage-data zichtbaar blijft.
    if (sheetItems.length) {
      saveStoredSpeedTrainings(sheetItems);
      renderPitcherSpeedOverview();
      setSyncStatus(`Speed training geladen uit datasheet: ${sheetItems.length} metingen.`, "ok");
      return sheetItems;
    }

    // Als de sheet leeg is, tonen we geen oude lokale cache meer.
    saveStoredSpeedTrainings([]);
    renderPitcherSpeedOverview();
    setSyncStatus("Geen speed-training gevonden in de datasheet.", "loading");
    return [];
  } catch (error) {
    console.error("Speed training teruglezen mislukt", error);
    setSyncStatus("SpeedTraining kon niet uit de datasheet worden geladen.", "error");
    return [];
  }
}

function normalizeSpeedPitchType(type) {
  const clean = String(type || "Fastball").trim() || "Fastball";
  const lower = clean.toLowerCase().replace(/\s+/g, "").replace(/-/g, "");

  if (["fast", "fb", "fastball"].includes(lower)) return "Fastball";
  if (["slow", "sb", "slowball"].includes(lower)) return "Slowball";
  if (["rise", "rb", "riseball"].includes(lower)) return "Riseball";
  if (["drop", "db", "dropball"].includes(lower)) return "Dropball";
  if (["change", "changeup", "ch"].includes(lower)) return "Change-up";
  if (["curve", "cb", "curveball"].includes(lower)) return "Curveball";
  if (["effect", "ef", "effectball"].includes(lower)) return "Effectball";

  return clean;
}

function openSpeedTrainingModal() {
  const modal = document.getElementById("speedTrainingModal");
  const pitcherSelect = document.getElementById("speedTrainingPitcher");
  const statsPitcher = document.getElementById("statsPitcherName");
  const dateInput = document.getElementById("speedTrainingDate");
  const valuesInput = document.getElementById("speedTrainingValues");

  if (pitcherSelect && statsPitcher?.value) pitcherSelect.value = statsPitcher.value;
  if (dateInput) dateInput.valueAsDate = new Date();
  if (valuesInput) valuesInput.value = "";

  selectedSpeedPitchType = "Fastball";
  renderSpeedPitchTypeButtons();

  if (modal) modal.classList.remove("hidden");
}

function closeSpeedTrainingModal() {
  const modal = document.getElementById("speedTrainingModal");
  if (modal) modal.classList.add("hidden");
}

function selectSpeedPitchType(type) {
  selectedSpeedPitchType = type === "__custom__" ? "__custom__" : normalizeSpeedPitchType(type);
  renderSpeedPitchTypeButtons();
}

function parseSpeedValues(raw) {
  return String(raw || "")
    .split(/[\s,;]+/)
    .map(value => Number(String(value).replace(",", ".")))
    .filter(value => Number.isFinite(value) && value > 0);
}


function parseBulkSpeedLines(raw, fallbackPitchType) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);

  const groups = lines.map(line => {
    let pitchType = "";
    let speedText = "";

    if (line.includes(":")) {
      const parts = line.split(":");
      pitchType = normalizeSpeedPitchType(parts.shift());
      speedText = parts.join(":");
    } else {
      const tokens = line.split(/\s+/).filter(Boolean);
      const firstNumberIndex = tokens.findIndex(token => Number.isFinite(Number(String(token).replace(",", "."))));

      if (firstNumberIndex > 0) {
        pitchType = normalizeSpeedPitchType(tokens.slice(0, firstNumberIndex).join(" "));
        speedText = tokens.slice(firstNumberIndex).join(" ");
      } else {
        pitchType = fallbackPitchType;
        speedText = line;
      }
    }

    const speeds = parseSpeedValues(speedText);
    return { pitchType, speeds };
  }).filter(group => group.pitchType && group.speeds.length);

  return groups;
}

function saveSpeedTraining() {
  const pitcherName = document.getElementById("speedTrainingPitcher")?.value || "";
  const date = document.getElementById("speedTrainingDate")?.value || new Date().toISOString().slice(0, 10);
  const rawValues = document.getElementById("speedTrainingValues")?.value || "";
  const customType = String(document.getElementById("customSpeedPitchType")?.value || "").trim();
  const fallbackPitchType = selectedSpeedPitchType === "__custom__" ? customType : selectedSpeedPitchType;

  if (!pitcherName) {
    alert("Kies eerst een pitcher.");
    return;
  }

  const groups = parseBulkSpeedLines(rawValues, fallbackPitchType);

  if (!groups.length) {
    alert("Vul minimaal één snelheid in.");
    return;
  }

  if (groups.some(group => !group.pitchType)) {
    alert("Vul een pitch type in.");
    return;
  }

  const items = getStoredSpeedTrainings();
  const now = new Date().toISOString();

  const newItems = [];

  groups.forEach(group => {
    group.speeds.forEach(speed => {
      newItems.push({
        id: `speed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        pitcherName,
        date,
        pitchType: group.pitchType,
        speed,
        unit: "mph",
        createdAt: now
      });
    });
  });

  newItems.forEach(item => items.push(item));

  saveStoredSpeedTrainings(items);
  closeSpeedTrainingModal();
  renderPitcherSpeedOverview();
  setSyncStatus(`Speed training opgeslagen: ${newItems.length} meting(en). Sync wordt gestart...`, "loading");

  newItems.forEach(item => {
    sendSpeedTrainingToGoogleSheet(item).catch(error => {
      console.error("Speed training sync fout", error);
      setSyncStatus("Speed training lokaal opgeslagen, maar online sync kon nog niet starten.", "error");
    });
  });
}

function getPitcherSpeedItems(pitcherName) {
  return getStoredSpeedTrainings()
    .filter(item => String(item.pitcherName || "") === String(pitcherName || ""))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function getSpeedPercent(speed) {
  const min = 40;
  const max = 60;
  return Math.max(0, Math.min(100, ((Number(speed || min) - min) / (max - min)) * 100));
}

function formatMph(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return `${Number(value).toFixed(1)} mph`;
}

function getSpeedStats(items) {
  const speeds = items.map(item => Number(item.speed)).filter(Number.isFinite);
  if (!speeds.length) {
    return { count: 0, avg: null, max: null };
  }

  const avg = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
  const max = Math.max(...speeds);

  return {
    count: speeds.length,
    avg,
    max
  };
}


function formatSpeedTrainingDate(dateValue) {
  const raw = String(dateValue || "").trim();
  if (!raw) return "-";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${String(isoMatch[1]).slice(-2)}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const year = String(parsed.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  }

  return raw;
}


function getSpeedColor(index) {
  const colors = ["#2563eb", "#16a34a", "#ff7417", "#e11d2e", "#7c3aed", "#0891b2", "#111827"];
  return colors[index % colors.length];
}

function getSpeedDateLabel(dateValue) {
  return formatSpeedTrainingDate(dateValue);
}

function groupSpeedItemsForChart(items) {
  const byTypeAndDate = new Map();

  items.forEach(item => {
    const type = normalizeSpeedPitchType(item.pitchType);
    const date = String(item.date || "").slice(0, 10);
    if (!type || !date) return;

    const key = `${type}|${date}`;
    if (!byTypeAndDate.has(key)) {
      byTypeAndDate.set(key, {
        type,
        date,
        speeds: []
      });
    }

    byTypeAndDate.get(key).speeds.push(Number(item.speed));
  });

  return [...byTypeAndDate.values()]
    .map(group => ({
      type: group.type,
      date: group.date,
      avg: group.speeds.reduce((sum, value) => sum + value, 0) / group.speeds.length,
      count: group.speeds.length
    }))
    .filter(point => Number.isFinite(point.avg))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function renderSpeedTrainingChart(items) {
  const svg = document.getElementById("speedTrainingChart");
  const legend = document.getElementById("speedChartLegend");
  if (!svg) return;

  const points = groupSpeedItemsForChart(items);
  const types = getSpeedPitchTypesForPitcher(document.getElementById("statsPitcherName")?.value || "", false)
    .filter(type => points.some(point => point.type === type));

  if (!points.length || !types.length) {
    svg.innerHTML = `
      <text x="360" y="132" text-anchor="middle" class="chart-empty-text">Nog geen trainingsdata</text>
    `;
    if (legend) legend.innerHTML = "";
    return;
  }

  const dates = [...new Set(points.map(point => point.date))].sort();
  const minSpeed = Math.max(30, Math.floor((Math.min(...points.map(point => point.avg)) - 3) / 5) * 5);
  const maxSpeed = Math.min(70, Math.ceil((Math.max(...points.map(point => point.avg)) + 3) / 5) * 5);

  const width = 720;
  const height = 260;
  const pad = { left: 48, right: 54, top: 20, bottom: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xForDate = date => {
    if (dates.length === 1) return pad.left + plotW / 2;
    const index = dates.indexOf(date);
    return pad.left + (index / (dates.length - 1)) * plotW;
  };

  const yForSpeed = speed => {
    const span = Math.max(1, maxSpeed - minSpeed);
    return pad.top + (1 - ((speed - minSpeed) / span)) * plotH;
  };

  const yTicks = [];
  for (let speed = minSpeed; speed <= maxSpeed; speed += 5) {
    yTicks.push(speed);
  }

  const grid = yTicks.map(speed => {
    const y = yForSpeed(speed);
    return `
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid-line"></line>
      <text x="${pad.left - 12}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${speed}</text>
    `;
  }).join("");

  const xLabels = dates.map(date => {
    const x = xForDate(date);
    return `<text x="${x}" y="${height - 15}" text-anchor="middle" class="chart-axis-label">${getSpeedDateLabel(date)}</text>`;
  }).join("");

  const lines = types.map((type, typeIndex) => {
    const typePoints = points.filter(point => point.type === type);
    const color = getSpeedColor(typeIndex);
    const coords = typePoints.map(point => ({
      ...point,
      x: xForDate(point.date),
      y: yForSpeed(point.avg)
    }));

    const polyline = coords.map(point => `${point.x},${point.y}`).join(" ");
    const dots = coords.map((point, index) => {
      const isLast = index === coords.length - 1;
      return `
        <circle cx="${point.x}" cy="${point.y}" r="${isLast ? 6 : 4.5}" fill="${color}" class="chart-point"></circle>
        ${isLast ? `<text x="${point.x + 10}" y="${point.y + 4}" class="chart-last-label" fill="${color}">${point.avg.toFixed(1)}</text>` : ""}
      `;
    }).join("");

    return `
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="chart-line"></polyline>
      ${dots}
    `;
  }).join("");

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" class="chart-bg"></rect>
    ${grid}
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" class="chart-axis-line"></line>
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" class="chart-axis-line"></line>
    ${xLabels}
    ${lines}
  `;

  if (legend) {
    legend.innerHTML = types.map((type, index) => `
      <span><i style="background:${getSpeedColor(index)}"></i>${getPitchTypeShortLabel(type)} ${type}</span>
    `).join("");
  }
}

function renderPitcherSpeedOverview() {
  const pitcherName = document.getElementById("statsPitcherName")?.value || "";
  const items = getPitcherSpeedItems(pitcherName);
  const fastballItems = items.filter(item => normalizeSpeedPitchType(item.pitchType) === "Fastball");
  const rangeStats = getSpeedStats(fastballItems);

  const avgDot = document.getElementById("speedAvgDot");
  const maxDot = document.getElementById("speedMaxDot");
  const latest = document.getElementById("speedLatestTraining");
  const grid = document.getElementById("speedTypeGrid");

  if (!pitcherName || !items.length) {
    if (avgDot) avgDot.style.left = "0%";
    if (maxDot) maxDot.style.left = "0%";
    if (latest) latest.textContent = pitcherName ? "Nog geen speed-training voor deze pitcher." : "Kies een pitcher om speed-data te tonen.";
    if (grid) grid.innerHTML = `<div class="speed-empty">Nog geen trainingssnelheden gevonden.</div>`;
    renderSpeedTrainingChart([]);
    return;
  }

  if (!fastballItems.length) {
    if (avgDot) avgDot.style.left = "0%";
    if (maxDot) maxDot.style.left = "0%";
  } else {
    if (avgDot) {
      avgDot.style.left = `${getSpeedPercent(rangeStats.avg)}%`;
      avgDot.title = `AVG Fastball ${formatMph(rangeStats.avg)}`;
    }
    if (maxDot) {
      maxDot.style.left = `${getSpeedPercent(rangeStats.max)}%`;
      maxDot.title = `MAX Fastball ${formatMph(rangeStats.max)}`;
    }
  }

  if (latest) latest.textContent = `Laatste training: ${formatSpeedTrainingDate(items[0].date)}`;

  if (grid) {
    const types = getSpeedPitchTypesForPitcher(pitcherName, false);
    grid.innerHTML = types.map(type => {
      return renderSpeedTypeCard(type, items.filter(item => normalizeSpeedPitchType(item.pitchType) === type));
    }).join("");
  }

  renderSpeedTrainingChart(items);
}

function renderSpeedTypeCard(type, items) {
  const stats = getSpeedStats(items);
  const short = getPitchTypeShortLabel(type);

  return `
    <div class="speed-type-card">
      <div class="speed-type-topline">
        <strong>${short}</strong>
        <em>${stats.count}x</em>
      </div>
      <span class="speed-type-name">${type}</span>
      <div class="speed-type-values">
        <div><small>AVG</small><b>${formatMph(stats.avg)}</b></div>
        <div><small>MAX</small><b>${formatMph(stats.max)}</b></div>
      </div>
    </div>
  `;
}

function showPitcherStats() {
  setActiveScreen("pitcherStatsScreen");
  syncFromGoogleSheet().finally(() => {
    renderPitcherStats();
    renderPitcherSpeedOverview();
  });
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

  let balls = 0;
  let strikes = 0;
  let outs = 0;

  (pitches || []).slice().reverse().forEach(p => {
    const result = String(p.result || "").trim();

    if (p.firstPitch) {
      balls = 0;
      strikes = 0;
    }

    if (["Ball", "HBP"].includes(result)) balls += 1;
    if (["Strike", "Swing"].includes(result)) strikes += 1;
    if (result === "Foul" && strikes < 2) strikes += 1;

    if (isOutResult(result)) {
      outs += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (strikes >= 3) {
      outs += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (p.walk || balls >= 4 || ["HBP", "HIT"].includes(result)) {
      balls = 0;
      strikes = 0;
    }
  });

  return outs;
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
  const strikeouts = countStrikeoutsFromPitches(pitches);
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
    strikeouts,
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
    const result = String(p.result || "").trim();

    if (p.firstPitch) {
      balls = 0;
      strikes = 0;
    }

    if (result === "Ball") balls += 1;
    if (["Strike", "Swing"].includes(result)) strikes += 1;
    if (result === "Foul" && strikes < 2) strikes += 1;

    if (p.walk || balls >= 4) {
      walks += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (["HBP", "HIT"].includes(result) || isOutResult(result) || strikes >= 3) {
      balls = 0;
      strikes = 0;
    }
  });

  return walks;
}


function getTrendArrow(currentValue, previousValue, positiveWhenHigher = true) {
  if (previousValue == null || Number.isNaN(previousValue)) return "";

  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);

  if (Math.abs(current - previous) < 0.0001) return "";

  const improved = positiveWhenHigher
    ? current > previous
    : current < previous;

  return improved ? "↑" : "↓";
}

function formatStatWithTrend(value, arrow) {
  return arrow ? `${value} ${arrow}` : String(value);
}

function resetPitcherStatsOverview() {
  setTextIfExists("statsTotalIP", "0.000");
  setTextIfExists("statsTotalPitches", "0");
  setTextIfExists("statsTotalBatters", "0");
  setTextIfExists("statsTotalStrikes", "0");
  setTextIfExists("statsTotalBalls", "0");
  setTextIfExists("statsSBRatio", "0.00");
  setTextIfExists("statsFPSBatters", "0%");
  setTextIfExists("statsTotalStrikeouts", "0");
  setTextIfExists("statsWalks", "0");
  setStatHighlight("statsFPSBatters", false);
  setStatHighlight("statsSBRatio", false);
}

function renderPitcherStats() {
  const select = document.getElementById("statsPitcherName");
  if (!select) return;

  const pitcherName = select.value;
  const body = document.getElementById("statsPerGameBody");

  if (!pitcherName) {
    resetPitcherStatsOverview();
    if (body) body.innerHTML = `<tr><td colspan="12">Kies een pitcher.</td></tr>`;
    return;
  }

  const games = getPitcherGames(pitcherName).sort((a, b) => getGameSortValue(b) - getGameSortValue(a));

  if (!games.length) {
    resetPitcherStatsOverview();
    if (body) body.innerHTML = `<tr><td colspan="12">Geen games gevonden voor ${pitcherName}.</td></tr>`;
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
    acc.strikeouts += s.strikeouts;
    acc.totalBatters += s.totalBatters;
    return acc;
  }, { totalPitches: 0, strikes: 0, balls: 0, outs: 0, fps: 0, walks: 0, strikeouts: 0, totalBatters: 0 });

  const totalsFpsPercent = getFpsPercentValue(totals.fps, totals.totalBatters);
  const currentSBRatio = totals.balls === 0 ? Number(totals.strikes) : Number(totals.strikes / totals.balls);

  const sortedGamesForTrend = [...games].sort((a, b) => getGameSortValue(a) - getGameSortValue(b));
  const previousGames = sortedGamesForTrend.slice(0, -1);

  const previousTotals = previousGames.reduce((acc, g) => {
    const s = calculateGameStats(g);
    acc.strikeouts += s.strikeouts;
    acc.walks += s.walks;
    acc.strikes += s.strikes;
    acc.balls += s.balls;
    acc.fps += s.fps;
    acc.totalBatters += s.totalBatters;
    return acc;
  }, { strikeouts: 0, walks: 0, strikes: 0, balls: 0, fps: 0, totalBatters: 0 });

  const previousSBRatio = previousTotals.balls === 0
    ? Number(previousTotals.strikes)
    : Number(previousTotals.strikes / previousTotals.balls);

  const previousFpsPercent = getFpsPercentValue(previousTotals.fps, previousTotals.totalBatters);

  const hasPreviousGame = previousGames.length > 0;
  const strikeoutTrendArrow = hasPreviousGame ? getTrendArrow(totals.strikeouts, previousTotals.strikeouts, true) : "";
  const walkTrendArrow = hasPreviousGame ? getTrendArrow(totals.walks, previousTotals.walks, true) : "";
  const sbTrendArrow = hasPreviousGame ? getTrendArrow(currentSBRatio, previousSBRatio, true) : "";
  const fpsTrendArrow = hasPreviousGame ? getTrendArrow(totalsFpsPercent, previousFpsPercent, true) : "";

  setTextIfExists("statsTotalIP", formatInningsPitched(totals.outs));
  setTextIfExists("statsTotalPitches", totals.totalPitches);
  setTextIfExists("statsTotalBatters", totals.totalBatters);
  setTextIfExists("statsTotalStrikes", totals.strikes);
  setTextIfExists("statsTotalBalls", totals.balls);
  setTextIfExists("statsSBRatio", formatStatWithTrend((totals.balls === 0 ? totals.strikes.toFixed(2) : (totals.strikes / totals.balls).toFixed(2)), sbTrendArrow));
  setTextIfExists("statsFPSBatters", formatStatWithTrend(`${totalsFpsPercent}%`, fpsTrendArrow));
  setTextIfExists("statsTotalStrikeouts", formatStatWithTrend(totals.strikeouts, strikeoutTrendArrow));
  setTextIfExists("statsWalks", formatStatWithTrend(totals.walks, walkTrendArrow));

  setStatHighlight("statsFPSBatters", totalsFpsPercent > 50);
  setStatHighlight("statsSBRatio", Number(currentSBRatio || 0) > 1);

  if (!body) return;

  body.innerHTML = games.map(g => {
    const s = calculateGameStats(g);
    return `
      <tr>
        <td>${formatDateTimeCompact(g.date, g.startTime)}</td>
        <td>${g.opponent || "-"}</td>
        <td>${s.totalPitches}</td>
        <td>${s.strikes}</td>
        <td>${s.balls}</td>
        <td>${s.ip}</td>
        <td>${s.fps}</td>
        <td class="${getGoodStatClass(Number(s.sbRatio) > 1)}">${s.sbRatio}</td>
        <td>${s.walks}</td>
        <td>${s.strikeouts || 0}</td>
        <td class="${getGoodStatClass(getFpsPercentValue(s.fps, s.totalBatters) > 50)}">${getFpsPercentValue(s.fps, s.totalBatters)}%</td>
      </tr>
    `;
  }).join("");

  renderPitcherSpeedOverview();
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
      pitcherName: p.pitcherName || g.pitcherName || "",
      gameDate: g.date || p.date || "",
      gameOpponent: g.opponent || p.opponent || "",
      gameId: g.gameId || p.gameId || ""
    }));
  }).filter(p => p && p.x != null && p.y != null && String(p.pitcherName || "").trim());
}

function populatePitcherHeatmapSelect() {
  const select = document.getElementById("pitcherHeatmapSelect");
  if (!select) return;

  const current = select.value;
  const pitcherNames = new Set();

  getStoredGames().forEach(g => {
    const gamePitcher = String(g.pitcherName || "").trim();
    if (gamePitcher) pitcherNames.add(gamePitcher);

    (g.pitches || []).forEach(p => {
      const pitchPitcher = String(p.pitcherName || "").trim();
      if (pitchPitcher) pitcherNames.add(pitchPitcher);
    });
  });

  ["statsPitcherName", "pitcherName", "newPitcherSelect"].forEach(selectId => {
    const existingSelect = document.getElementById(selectId);
    if (!existingSelect) return;

    [...existingSelect.options].forEach(option => {
      const value = String(option.value || option.textContent || "").trim();
      if (
        value &&
        value !== "Kies pitcher" &&
        value !== "Overig" &&
        !value.toLowerCase().includes("kies")
      ) {
        pitcherNames.add(value);
      }
    });
  });

  const pitchers = [...pitcherNames].sort((a, b) => a.localeCompare(b));

  select.innerHTML = `<option value="">Kies pitcher</option>` + pitchers.map(name =>
    `<option value="${name}">${name}</option>`
  ).join("");

  if (pitchers.includes(current)) {
    select.value = current;
  } else if (pitchers.length) {
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
  const bounds = getDisplayPitchBounds("standard");
  const displayRangeX = bounds.maxX - bounds.minX;
  const displayRangeY = bounds.maxY - bounds.minY;
  const toDisplayX = value => toDisplayPercent(value, bounds.minX, bounds.maxX);
  const toDisplayY = value => toDisplayPercent(value, bounds.minY, bounds.maxY);

  if (zone) {
    applyStrikeZoneToElement(zone, "standard");
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "rgba(19,45,77,0.98)");
  bg.addColorStop(1, "rgba(5,7,12,0.98)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (empty) empty.classList.toggle("hidden", Boolean(pitches.length));
  if (!pitches.length) return;

  const gridW = 96;
  const gridH = 90;
  const grid = Array.from({ length: gridH }, () => Array(gridW).fill(0));
  const radius = 6;

  pitches.forEach(p => {
    const displayX = (Number(p.x || 0) - bounds.minX) / displayRangeX;
    const displayY = (Number(p.y || 0) - bounds.minY) / displayRangeY;

    const gx = Math.round(Math.min(1, Math.max(0, displayX)) * (gridW - 1));
    const gy = Math.round(Math.min(1, Math.max(0, displayY)) * (gridH - 1));

    for (let y = Math.max(0, gy - radius); y <= Math.min(gridH - 1, gy + radius); y++) {
      for (let x = Math.max(0, gx - radius); x <= Math.min(gridW - 1, gx + radius); x++) {
        const dx = x - gx;
        const dy = y - gy;
        const distSq = dx * dx + dy * dy;
        const weight = Math.exp(-distSq / 15);
        grid[y][x] += weight;
      }
    }
  });

  const max = Math.max(...grid.flat(), 1);

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const v = grid[y][x] / max;
      if (v < 0.035) continue;

      const px = (x / gridW) * width;
      const py = (y / gridH) * height;
      const cellW = Math.ceil(width / gridW) + 2;
      const cellH = Math.ceil(height / gridH) + 2;

      ctx.fillStyle = getDensityColor(v);
      ctx.globalAlpha = Math.min(0.92, 0.16 + v * 0.84);
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
    populateBatterSearchExtraFilters();
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



function getBatterSearchBaseMatches() {
  const opponentSelect = document.getElementById("batterSearchOpponent");
  const playerSelect = document.getElementById("batterSearchPlayer");

  const selectedOpponent = opponentSelect ? opponentSelect.value : "";
  const selectedPlayer = playerSelect ? playerSelect.value : "";

  if (!selectedOpponent || !selectedPlayer) return [];

  const [selectedName, selectedNumber] = selectedPlayer.split("|");

  return getAllPitchesFromStoredGames().filter(p => {
    return p.gameOpponent === selectedOpponent &&
      String(p.batterName || "") === selectedName &&
      String(p.batterNumber || "") === selectedNumber;
  });
}

function populateBatterSearchExtraFilters() {
  const pitcherSelect = document.getElementById("batterSearchPitcherFilter");
  const gameSelect = document.getElementById("batterSearchGameFilter");
  if (!pitcherSelect || !gameSelect) return;

  const currentPitcher = pitcherSelect.value;
  const currentGame = gameSelect.value;
  const matches = getBatterSearchBaseMatches();

  const pitchers = [...new Set(matches.map(p => String(p.pitcherName || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const games = [...new Map(matches.map(p => {
    const key = p.gameId || `${p.gameDate || p.date || ""}-${p.gameOpponent || ""}-${p.startTime || ""}`;
    const label = `${formatDateTimeCompact(p.gameDate || p.date, p.startTime)} · ${p.gameOpponent || "-"}`;
    return [key, { key, label }];
  })).values()]
    .sort((a, b) => b.label.localeCompare(a.label));

  pitcherSelect.innerHTML =
    `<option value="">Alle pitchers</option>` +
    pitchers.map(pitcher => `<option value="${pitcher}">${pitcher}</option>`).join("");

  gameSelect.innerHTML =
    `<option value="">Alle wedstrijden</option>` +
    games.map(game => `<option value="${game.key}">${game.label}</option>`).join("");

  if (pitchers.includes(currentPitcher)) pitcherSelect.value = currentPitcher;
  if (games.some(game => game.key === currentGame)) gameSelect.value = currentGame;
}



function normalizeResultValue(result) {
  return String(result || "").trim().toLowerCase();
}

function isBattedBallResult(result) {
  const clean = normalizeResultValue(result);
  return clean === "hit" || clean === "veld uit" || clean === "velduit";
}

function getBatterSearchBattedBalls(matches) {
  return (matches || []).filter(p => isBattedBallResult(p.result));
}

function renderBatterSearchBattedBalls(matches) {
  const field = document.getElementById("batterSearchBattedBallField");
  const layer = document.getElementById("batterSearchBattedBallLayer") || field;
  const list = document.getElementById("batterSearchBattedBallList");
  if (!field || !list || !layer) return;

  layer.querySelectorAll(".batter-search-batted-marker").forEach(marker => marker.remove());

  const battedBalls = getBatterSearchBattedBalls(matches);

  if (!battedBalls.length) {
    list.innerHTML = `<p class="small-note">Geen geslagen ballen met HIT of Veld uit gevonden voor deze slagvrouw.</p>`;
    return;
  }

  battedBalls.forEach((p, index) => {
    const x = Number(p.battedBallX);
    const y = Number(p.battedBallY);

    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return;

    const marker = document.createElement("div");
    marker.className = `batter-search-batted-marker ${normalizeResultValue(p.result) === "hit" ? "hit" : "out"}`;
    marker.style.left = `${Math.max(0, Math.min(100, x))}%`;
    marker.style.top = `${Math.max(0, Math.min(100, y))}%`;
    marker.textContent = index + 1;
    marker.title = `${p.result} · ${p.battedBallZone || "Zone onbekend"}`;
    layer.appendChild(marker);
  });

  list.innerHTML = battedBalls
    .slice()
    .reverse()
    .map((p, reverseIndex) => {
      const index = battedBalls.length - reverseIndex;
      return `
        <div class="batter-search-batted-row">
          <strong>${index}. ${p.result || "Geslagen bal"} · ${p.battedBallZone || "Locatie niet gevonden"}</strong>
          <span>${formatDateTimeCompact(p.gameDate, p.startTime)} · ${[p.battedBallHardness, p.battedBallHeight, p.pitchType].filter(Boolean).join(" · ") || "Geen extra info"}</span>
        </div>
      `;
    })
    .join("");
}


function renderBatterSearch() {
  const opponentSelect = document.getElementById("batterSearchOpponent");
  const playerSelect = document.getElementById("batterSearchPlayer");

  const selectedOpponent = opponentSelect ? opponentSelect.value : "";
  const selectedPlayer = playerSelect ? playerSelect.value : "";
  const selectedPitcher = document.getElementById("batterSearchPitcherFilter")?.value || "";
  const selectedGame = document.getElementById("batterSearchGameFilter")?.value || "";
  const heatmap = document.getElementById("batterSearchHeatmap");
  const battedBallField = document.getElementById("batterSearchBattedBallField");
  const battedBallList = document.getElementById("batterSearchBattedBallList");
  const body = document.getElementById("batterSearchTableBody");

  if (heatmap) heatmap.querySelectorAll(".heat-dot").forEach(dot => dot.remove());
  if (battedBallField) {
    const battedLayer = document.getElementById("batterSearchBattedBallLayer") || battedBallField;
    battedLayer.querySelectorAll(".batter-search-batted-marker").forEach(marker => marker.remove());
  }

  if (!selectedOpponent || !selectedPlayer) {
    document.getElementById("batterSearchPitches").textContent = "0";
    document.getElementById("batterSearchHits").textContent = "0";
    document.getElementById("batterSearchOuts").textContent = "0";
    document.getElementById("batterSearchBalls").textContent = "0";
    document.getElementById("batterSearchStrikes").textContent = "0";
    document.getElementById("batterSearchGames").textContent = "0";
    document.getElementById("batterSearchAverage").textContent = atBats > 0 ? (hits / atBats).toFixed(3).replace(/^0/, "") : ".000";
    if (battedBallList) battedBallList.innerHTML = `<p class="small-note">Kies een tegenstander en slagvrouw.</p>`;
    body.innerHTML = `<tr><td colspan="7">Kies een tegenstander en slagvrouw.</td></tr>`;
    return;
  }

  const matches = getBatterSearchBaseMatches().filter(p => {
    const gameKey = p.gameId || `${p.gameDate || p.date || ""}-${p.gameOpponent || ""}-${p.startTime || ""}`;

    if (selectedPitcher && String(p.pitcherName || "") !== selectedPitcher) return false;
    if (selectedGame && gameKey !== selectedGame) return false;

    return true;
  });

  const hits = matches.filter(p => normalizeResultValue(p.result) === "hit").length;
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

  renderBatterSearchBattedBalls(matches);

  matches.forEach((p, index) => {
    if (!heatmap || p.x == null || p.y == null) return;

    const dot = document.createElement("div");
    dot.className = "heat-dot";
    const heatClass = getHeatDotClass(p.result);
    if (heatClass) dot.classList.add(heatClass);
    const displayPoint = getDisplayPoint(p, "standard");
    dot.style.left = `${displayPoint.x}%`;
    dot.style.top = `${displayPoint.y}%`;
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
  if (select && select.value) return select.value;
  return "";
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

  slotInput.value = slot;
  if (meta) meta.textContent = `Positie ${slot} · ${teamName}`;

  select.innerHTML = `<option value="">Kies speelster</option>` + players.map((player, index) => {
    const playerName = String(player.name || "");
    const playerNumber = String(player.number || "");
    const usedSlot = findLineupSlotByPlayer(playerName, playerNumber);
    const suffix = usedSlot && usedSlot !== Number(slot)
      ? ` (staat op positie ${usedSlot}; wordt gewisseld)`
      : "";

    return `<option value="${index}">${player.name || "Onbekende slagvrouw"} #${player.number || "?"}${suffix}</option>`;
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

function findLineupSlotByPlayer(name, number, ignoredSlot = null) {
  const targetName = String(name || "").trim();
  const targetNumber = String(number || "").trim();

  if (!targetName && !targetNumber) return null;

  for (let i = 1; i <= 16; i++) {
    if (ignoredSlot !== null && i === Number(ignoredSlot)) continue;

    const currentName = String(document.getElementById(`name${i}`)?.value || "").trim();
    const currentNumber = String(document.getElementById(`num${i}`)?.value || "").trim();

    if (currentName === targetName && currentNumber === targetNumber) return i;
  }

  return null;
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

  if (!nameInput || !numInput) return;

  const currentName = String(nameInput.value || "").trim();
  const currentNumber = String(numInput.value || "").trim();
  const selectedName = String(player.name || "");
  const selectedNumber = String(player.number || "");
  const existingSlot = findLineupSlotByPlayer(selectedName, selectedNumber, slot);

  // Als de gekozen speelster al op een andere plek staat, wissel de twee posities om.
  // Zo kun je in Nieuwe game de slaglijst blijven herschikken zonder eerst velden leeg te maken.
  if (existingSlot) {
    const existingNameInput = document.getElementById(`name${existingSlot}`);
    const existingNumInput = document.getElementById(`num${existingSlot}`);

    if (existingNameInput && existingNumInput) {
      existingNameInput.value = currentName;
      existingNumInput.value = currentNumber;
    }
  }

  nameInput.value = selectedName;
  numInput.value = selectedNumber;

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
  startOfflineAutoRetry();
}


function requireEditPassword(message = "Voer wachtwoord in om deze game te openen/wijzigen:") {
  const password = prompt(message);
  return password === "Edit";
}


// Oude naam blijft bestaan, maar gaat nu verplicht via wachtwoord.




let selectedGameRecapText = "";

function showGameRecaps() {
  setActiveScreen("gameRecapsScreen");

  const list = document.getElementById("gameRecapsList");
  if (list) {
    list.innerHTML = `<p class="small-note">Wedstrijden worden geladen...</p>`;
  }

  syncFromGoogleSheet()
    .catch(() => [])
    .finally(() => {
      renderGameRecapCards();
    });
}


function getGameRecapSortValue(g) {
  const rawDate = String(g.date || "").trim();
  const rawTime = String(g.startTime || "00:00").trim() || "00:00";

  let year = 0;
  let month = 0;
  let day = 0;

  const isoDateTimeMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  const isoDateOnlyMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const nlDateMatch = rawDate.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);

  if (isoDateTimeMatch) {
    year = Number(isoDateTimeMatch[1]);
    month = Number(isoDateTimeMatch[2]) - 1;
    day = Number(isoDateTimeMatch[3]);
  } else if (isoDateOnlyMatch) {
    year = Number(isoDateOnlyMatch[1]);
    month = Number(isoDateOnlyMatch[2]) - 1;
    day = Number(isoDateOnlyMatch[3]);
  } else if (nlDateMatch) {
    day = Number(nlDateMatch[1]);
    month = Number(nlDateMatch[2]) - 1;
    year = Number(nlDateMatch[3]);
    if (year < 100) year += 2000;
  } else {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      year = parsed.getFullYear();
      month = parsed.getMonth();
      day = parsed.getDate();
    }
  }

  const timeMatch = rawTime.match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  if (!year || !day) return 0;

  return new Date(year, month, day, hour, minute).getTime();
}

function getGamesForRecaps() {
  return getStoredGames()
    .filter(g => Array.isArray(g.pitches) && g.pitches.length)
    .sort((a, b) => getGameRecapSortValue(b) - getGameRecapSortValue(a));
}

function getPitcherNamesForGame(g) {
  const names = new Set();

  if (g.pitcherName) names.add(String(g.pitcherName));

  (g.pitches || []).forEach(p => {
    if (p.pitcherName) names.add(String(p.pitcherName));
  });

  return [...names].filter(Boolean);
}

function getPitcherInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function renderGameRecapCards() {
  const list = document.getElementById("gameRecapsList");
  if (!list) return;

  const games = getGamesForRecaps();

  if (!games.length) {
    list.innerHTML = `<p class="small-note">Geen wedstrijden gevonden voor Game Recaps.</p>`;
    return;
  }

  list.innerHTML = games.map(g => {
    const title = `${formatDateTimeCompact(g.date, g.startTime)} · ${g.opponent || "Onbekende tegenstander"}`;
    const pitchers = getPitcherNamesForGame(g);

    const pitcherBlocks = pitchers.map(pitcherName => {
      const pitcherPitches = (g.pitches || []).filter(p =>
        String(p.pitcherName || g.pitcherName || "") === pitcherName
      );

      const stats = calculateGameStats({
        ...g,
        pitcherName,
        pitches: pitcherPitches
      });

      const strikePct = pitcherPitches.length
        ? Math.round((stats.strikes / pitcherPitches.length) * 100)
        : 0;

      return `
        <div class="game-recap-card-pitcher">
          <div class="pitcher-initials">${getPitcherInitials(pitcherName)}</div>
          <div>
            <strong>${pitcherName}</strong>
            <span>${stats.totalPitches}P · ${strikePct}% strikes · ${stats.strikeouts || 0}K · ${stats.walks || 0}BB</span>
          </div>
        </div>
      `;
    }).join("");

    return `
      <button type="button" class="game-recap-list-card" onclick="openGameRecapModal('${g.gameId}')">
        <div class="game-recap-card-title">
          <strong>${title}</strong>
          <span>→</span>
        </div>
        <div class="game-recap-card-pitchers">
          ${pitcherBlocks}
        </div>
      </button>
    `;
  }).join("");
}

function openGameRecapModal(gameId) {
  const modal = document.getElementById("gameRecapModal");
  const titleEl = document.getElementById("gameRecapModalTitle");
  const body = document.getElementById("gameRecapModalBody");
  if (!modal || !titleEl || !body) return;

  const game = getGamesForRecaps().find(g => g.gameId === gameId);
  if (!game) {
    alert("Deze wedstrijd kon niet worden gevonden.");
    return;
  }

  const recap = buildGameRecap(game);
  titleEl.textContent = recap.title || "Game Recap";
  body.innerHTML = recap.html;
  body.dataset.copyText = recap.text;
  selectedGameRecapText = recap.text;

  modal.classList.remove("hidden");
}

function closeGameRecapModal() {
  const modal = document.getElementById("gameRecapModal");
  if (modal) modal.classList.add("hidden");
}

function getPitchResultBucket(result) {
  if (["Ball", "HBP"].includes(result)) return "ball";
  if (isStrikeResult(result)) return "strike";
  return "other";
}

function getZoneBucketForRecap(p) {
  const x = Number(p.x || 50);
  const y = Number(p.y || 50);

  if (
    x < STRIKE_ZONE.left ||
    x > STRIKE_ZONE.right ||
    y < STRIKE_ZONE.top ||
    y > STRIKE_ZONE.bottom
  ) {
    if (y < STRIKE_ZONE.top) return "hoog buiten de zone";
    if (y > STRIKE_ZONE.bottom) return "laag buiten de zone";
    if (x < STRIKE_ZONE.left) return "inside buiten de zone";
    if (x > STRIKE_ZONE.right) return "outside buiten de zone";
    return "buiten de zone";
  }

  const zoneWidth = STRIKE_ZONE.right - STRIKE_ZONE.left;
  const zoneHeight = STRIKE_ZONE.bottom - STRIKE_ZONE.top;
  const relativeX = (x - STRIKE_ZONE.left) / zoneWidth;
  const relativeY = (y - STRIKE_ZONE.top) / zoneHeight;

  let horizontal = "midden";
  if (relativeX <= 0.33) horizontal = "inside";
  else if (relativeX >= 0.66) horizontal = "outside";

  let vertical = "midden";
  if (relativeY <= 0.33) vertical = "hoog";
  else if (relativeY >= 0.66) vertical = "laag";

  return `${vertical} ${horizontal}`;
}

function getMostCommon(items) {
  const counts = new Map();
  items.filter(Boolean).forEach(item => counts.set(item, (counts.get(item) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || ["-", 0];
}

function splitPitchesIntoPhases(pitches) {
  const ordered = [...pitches].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  if (ordered.length < 6) {
    return { early: ordered, late: ordered };
  }

  const midpoint = Math.ceil(ordered.length / 2);
  return {
    early: ordered.slice(0, midpoint),
    late: ordered.slice(midpoint)
  };
}

function getPhaseStats(pitches) {
  const total = pitches.length;
  const balls = pitches.filter(p => ["Ball", "HBP"].includes(p.result)).length;
  const strikes = pitches.filter(p => isStrikeResult(p.result)).length;
  const walks = countWalks({ pitches });
  const strikeouts = countStrikeoutsFromPitches(pitches);
  const fps = pitches.filter(p => p.firstPitch && isStrikeResult(p.result)).length;
  const batters = pitches.filter(p => p.firstPitch).length;

  return {
    total,
    balls,
    strikes,
    walks,
    strikeouts,
    ballPct: total ? Math.round((balls / total) * 100) : 0,
    strikePct: total ? Math.round((strikes / total) * 100) : 0,
    fpsPct: batters ? Math.round((fps / batters) * 100) : 0
  };
}

function buildGameRecap(game) {
  const pitches = [...(game.pitches || [])].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  const pitchers = getPitcherNamesForGame(game);

  const title = `${formatDateTimeCompact(game.date, game.startTime)} · ${game.opponent || "Onbekende tegenstander"}`;

  const pitcherSections = pitchers.map(pitcherName => {
    const pitcherPitches = pitches.filter(p => String(p.pitcherName || game.pitcherName || "") === pitcherName);

    const stats = calculateGameStats({
      ...game,
      pitcherName,
      pitches: pitcherPitches
    });

    const strikePct = pitcherPitches.length
      ? Math.round((stats.strikes / pitcherPitches.length) * 100)
      : 0;

    const ballPct = pitcherPitches.length
      ? Math.round((stats.balls / pitcherPitches.length) * 100)
      : 0;

    const fpsPct = getFpsPercentValue(stats.fps, stats.totalBatters);

    const strikeZones = pitcherPitches
      .filter(p => isStrikeResult(p.result))
      .map(getZoneBucketForRecap);

    const ballZones = pitcherPitches
      .filter(p => ["Ball", "HBP"].includes(p.result))
      .map(getZoneBucketForRecap);

    const [bestZone, bestZoneCount] = getMostCommon(strikeZones);
    const [wideZone, wideZoneCount] = getMostCommon(ballZones);

    const { early, late } = splitPitchesIntoPhases(pitcherPitches);
    const earlyStats = getPhaseStats(early);
    const lateStats = getPhaseStats(late);

    const summaryLines = [];

    summaryLines.push(
      `${pitcherName} gooide ${stats.totalPitches} pitches: ${stats.strikes} strikes en ${stats.balls} balls. Het strikepercentage was ${strikePct}% en het FPS% was ${fpsPct}%.`
    );

    if (early.length && late.length) {
      if (lateStats.ballPct > earlyStats.ballPct + 10) {
        summaryLines.push(
          `In het tweede deel van haar pitches nam het aantal balls toe: van ${earlyStats.ballPct}% naar ${lateStats.ballPct}%.`
        );
      } else if (lateStats.strikePct > earlyStats.strikePct + 10) {
        summaryLines.push(
          `In het tweede deel van haar pitches werd ze sterker met meer strikes: van ${earlyStats.strikePct}% naar ${lateStats.strikePct}%.`
        );
      } else {
        summaryLines.push(
          `Het verschil tussen het eerste en tweede deel van haar pitches bleef klein.`
        );
      }
    }

    if (bestZone && bestZone !== "-") {
      summaryLines.push(
        `De meeste strikes kwamen rond ${bestZone}.`
      );
    }

    if (wideZone && wideZone !== "-") {
      summaryLines.push(
        `De meeste balls zaten rond ${wideZone}.`
      );
    }

    const strengths = [];
    if (strikePct >= 60) strengths.push(`goed strikepercentage (${strikePct}%)`);
    if (fpsPct >= 55) strengths.push(`veel first-pitch strikes (${fpsPct}% FPS)`);
    if (stats.walks === 0) strengths.push(`geen walks toegestaan`);
    if (stats.strikeouts >= 2) strengths.push(`${stats.strikeouts} strikeouts`);
    if (bestZone && bestZone !== "-" && bestZoneCount >= 2) strengths.push(`veel strikes rond ${bestZone}`);

    const focus = [];

    if (ballPct >= 40) {
      focus.push(`hoog aantal balls (${ballPct}%)`);
    }

    if (lateStats.ballPct > earlyStats.ballPct + 10) {
      focus.push(`meer balls in het tweede deel van haar pitches`);
    }

    if (wideZone && wideZone.includes("outside")) {
      focus.push(`meerdere misses outside buiten de zone`);
    } else if (wideZone && wideZone.includes("inside")) {
      focus.push(`meerdere misses inside buiten de zone`);
    } else if (wideZone && wideZone.includes("hoog")) {
      focus.push(`meerdere pitches hoog buiten de zone`);
    } else if (wideZone && wideZone.includes("laag")) {
      focus.push(`meerdere pitches laag buiten de zone`);
    }

    if (stats.walks >= 1) {
      focus.push(`${stats.walks} walk${stats.walks === 1 ? "" : "s"} toegestaan`);
    }

    const uniqueStrengths = [...new Set(strengths)].slice(0, 4);
    const uniqueFocus = [...new Set(focus)].slice(0, 4);

    const textBlock = [
      `${pitcherName}`,
      `${stats.totalPitches} pitches • ${stats.strikes} strikes • ${stats.balls} balls • ${strikePct}% strikes • ${fpsPct}% FPS • ${stats.strikeouts || 0} K • ${stats.walks || 0} BB`,
      ``,
      ...summaryLines,
      ``,
      `Sterk:`,
      ...(uniqueStrengths.length ? uniqueStrengths.map(s => `- ${s}`) : [`- stabiel genoeg om door te bouwen`]),
      ``,
      `Punt van aandacht:`,
      ...(uniqueFocus.length ? uniqueFocus.map(f => `- ${f}`) : [`- geen duidelijk groot aandachtspunt uit deze data`]),
      ``
    ].join("\\n");

    const htmlBlock = `
      <div class="game-recap-pitcher">
        <div class="game-recap-pitcher-heading">
          <div class="pitcher-initials">${getPitcherInitials(pitcherName)}</div>
          <div>
            <h4>${pitcherName}</h4>
            <div class="recap-pitcher-stats">
              ${stats.totalPitches} pitches • ${stats.strikes} strikes • ${stats.balls} balls • ${strikePct}% strikes • ${fpsPct}% FPS • ${stats.strikeouts || 0} K • ${stats.walks || 0} BB
            </div>
          </div>
        </div>

        ${summaryLines.map(line => `<p>${line}</p>`).join("")}

        <div class="recap-two-columns">
          <div class="recap-insight good">
            <strong>Sterk</strong>
            <ul>
              ${(uniqueStrengths.length ? uniqueStrengths : ["stabiel genoeg om door te bouwen"]).map(s => `<li>${s}</li>`).join("")}
            </ul>
          </div>

          <div class="recap-insight attention">
            <strong>Punt van aandacht</strong>
            <ul>
              ${(uniqueFocus.length ? uniqueFocus : ["geen duidelijk groot aandachtspunt uit deze data"]).map(f => `<li>${f}</li>`).join("")}
            </ul>
          </div>
        </div>
      </div>
    `;

    return {
      textBlock,
      htmlBlock
    };
  });

  const text = [
    `Game Recap — ${title}`,
    ``,
    ...pitcherSections.map(p => p.textBlock)
  ].join("\\n");

  const html = `
    <div class="game-recap-card">
      ${pitcherSections.map(p => p.htmlBlock).join("")}
    </div>
  `;

  return { title, html, text };
}

async function copyGameRecap() {
  const text = selectedGameRecapText || document.getElementById("gameRecapModalBody")?.dataset?.copyText || "";

  if (!text) {
    alert("Geen recap om te kopiëren.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setSyncStatus("Game recap gekopieerd.", "ok");
  } catch (error) {
    alert(text);
  }
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
    const result = String(p.result || "").trim();

    if (p.firstPitch) {
      balls = 0;
      strikes = 0;
    }

    if (result === "Strike out" || result === "Strikeout" || result === "Strike-out") {
      strikeouts += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (["Ball", "HBP"].includes(result)) balls += 1;
    if (["Strike", "Swing"].includes(result)) strikes += 1;
    if (result === "Foul" && strikes < 2) strikes += 1;

    if (strikes >= 3) {
      strikeouts += 1;
      balls = 0;
      strikes = 0;
      return;
    }

    if (p.walk || balls >= 4 || ["HBP", "HIT", "Out", "Veld uit"].includes(result)) {
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
  game.batterCounts = {};
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
  setSyncStatus("Online - alles gesynchroniseerd.", "ok");
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


function bindBattedBallModalEvents() {
  document.querySelectorAll("[data-bb-key][data-bb-value]").forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      selectBattedBallOption(button.dataset.bbKey, button.dataset.bbValue);
    });
  });
}

function savePitch() {
  if (!game.pitchLocation) {
    alert("Tik eerst op de plek waar de bal kwam.");
    return;
  }

  if (["HIT", "Veld uit"].includes(game.result)) {
    openBattedBallModal(game.result);
    return;
  }

  savePitchFinal();
}

function savePitchFinal(extra = {}) {
  if (!game.pitchLocation) {
    alert("Tik eerst op de plek waar de bal kwam.");
    return;
  }

  const batter = game.lineup[game.batterIndex];
  const isFirstPitch = game.balls === 0 && game.strikes === 0;
  const zone = getPitchZone(game.pitchLocation.x, game.pitchLocation.y);

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
    zoneHorizontal: zone.horizontal,
    zoneVertical: zone.vertical,
    zoneLabel: zone.label,
    ballsBefore: game.balls,
    strikesBefore: game.strikes,
    outsBefore: game.totalOuts,
    firstPitch: isFirstPitch,
    walk: game.balls === 3 && game.result === "Ball",
    battedBallX: extra.battedBallX || "",
    battedBallY: extra.battedBallY || "",
    battedBallZone: extra.battedBallZone || "",
    battedBallHardness: extra.battedBallHardness || "",
    battedBallHeight: extra.battedBallHeight || ""
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
  setSyncStatus("Pitch lokaal opgeslagen. Sync wordt gestart...", "loading");
  sendPitchToGoogleSheet(pitch).catch(error => {
    console.error("Pitch offline sync fout", error);
    setSyncStatus("Pitch lokaal opgeslagen, maar sync kon nog niet starten.", "error");
  });
  updateUI();
}

let pendingBattedBall = null;

function openBattedBallModal(result) {
  pendingBattedBall = {
    result,
    x: "",
    y: "",
    zone: "",
    hardness: "Hard",
    height: "Line Drive"
  };

  const modal = document.getElementById("battedBallModal");
  const title = document.getElementById("battedBallTitle");
  const help = document.getElementById("battedBallHelp");
  const marker = document.getElementById("battedBallMarker");
  const chosen = document.getElementById("battedBallChosen");

  if (title) {
    title.textContent = result === "HIT"
      ? "Waar is de bal geslagen?"
      : "Veld uit — waar is de bal gevangen?";
  }

  if (help) {
    help.textContent = result === "HIT"
      ? "Tik op de plek op het veld waar de bal is geslagen."
      : "Tik op de plek op het veld waar de bal is gevangen.";
  }

  if (marker) marker.classList.add("hidden");
  if (chosen) chosen.textContent = "Nog geen plek gekozen.";

  setBattedBallSelectedButtons();
  if (modal) modal.classList.remove("hidden");
}

function cancelBattedBallModal() {
  const modal = document.getElementById("battedBallModal");
  if (modal) modal.classList.add("hidden");
  pendingBattedBall = null;
}

function selectBattedBallOption(key, value) {
  if (!pendingBattedBall) return;

  pendingBattedBall[key] = value;
  setBattedBallSelectedButtons();
}

function setBattedBallSelectedButtons() {
  document.querySelectorAll("[data-bb-key]").forEach(button => {
    const key = button.dataset.bbKey;
    const value = button.dataset.bbValue;
    const isSelected = pendingBattedBall && pendingBattedBall[key] === value;

    button.classList.toggle("selected", Boolean(isSelected));
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

const BATTED_BALL_HOME = { x: 50, y: 84 };
const BATTED_BALL_LEFT_FOUL_ANGLE = 133;
const BATTED_BALL_RIGHT_FOUL_ANGLE = 47;
const BATTED_BALL_DIRT_POLYGON = [
  { x: 50, y: 92 },
  { x: 42, y: 80 },
  { x: 22, y: 62 },
  { x: 30, y: 50 },
  { x: 41, y: 43 },
  { x: 50, y: 41 },
  { x: 59, y: 43 },
  { x: 70, y: 50 },
  { x: 78, y: 62 },
  { x: 58, y: 80 }
];

function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 0.00001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getOutfieldSprayZone(x, y) {
  const angle = Math.atan2(BATTED_BALL_HOME.y - y, x - BATTED_BALL_HOME.x) * 180 / Math.PI;
  const span = BATTED_BALL_LEFT_FOUL_ANGLE - BATTED_BALL_RIGHT_FOUL_ANGLE;
  const pct = Math.max(0, Math.min(100, ((BATTED_BALL_LEFT_FOUL_ANGLE - angle) / span) * 100));

  if (pct <= 25) return "Linksveld";
  if (pct <= 35) return "Links-center";
  if (pct <= 65) return "Centerfield";
  if (pct <= 75) return "Rechts-center";
  return "Rechtsveld";
}

function getBattedBallAngle(x, y) {
  return Math.atan2(BATTED_BALL_HOME.y - y, x - BATTED_BALL_HOME.x) * 180 / Math.PI;
}

function isLeftOfLeftFoulLine(x, y) {
  return getBattedBallAngle(x, y) > BATTED_BALL_LEFT_FOUL_ANGLE;
}

function isRightOfRightFoulLine(x, y) {
  return getBattedBallAngle(x, y) < BATTED_BALL_RIGHT_FOUL_ANGLE;
}

function getInfieldSprayZone(x, y) {
  if (y >= 82) return "Catcher";

  // Pitcher-bereik bewust klein: alleen ballen dicht rond de cirkel.
  if (y >= 61 && y <= 70 && Math.abs(x - 50) <= 5) return "Pitcher";

  if (x < 36) return "Derde honk";
  if (x < 50) return "Kortstop";
  if (x < 64) return "Tweede honk";
  return "Eerste honk";
}

function getBattedBallZone(x, y) {
  const point = { x: Number(x), y: Number(y) };

  // Buiten de foullijnen ter hoogte van het infield:
  // links is voor 3e honk, rechts is voor 1e honk.
  if (point.y >= 45 && isLeftOfLeftFoulLine(point.x, point.y)) return "Derde honk";
  if (point.y >= 45 && isRightOfRightFoulLine(point.x, point.y)) return "Eerste honk";

  // Alles op het gravel = infielder.
  if (isPointInPolygon(point, BATTED_BALL_DIRT_POLYGON)) {
    return getInfieldSprayZone(point.x, point.y);
  }

  // Alles op het gras binnen de foullijnen = outfield.
  return getOutfieldSprayZone(point.x, point.y);
}

function getBattedBallPointFromEvent(field, event) {
  const rect = field.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y))
  };
}

function setBattedBallLocation(event) {
  if (!pendingBattedBall) return;

  const field = document.getElementById("battedBallField");
  const marker = document.getElementById("battedBallMarker");
  const chosen = document.getElementById("battedBallChosen");
  if (!field || !marker) return;

  const point = getBattedBallPointFromEvent(field, event);

  pendingBattedBall.x = Math.round(point.x);
  pendingBattedBall.y = Math.round(point.y);
  pendingBattedBall.zone = getBattedBallZone(pendingBattedBall.x, pendingBattedBall.y);

  marker.style.left = `${pendingBattedBall.x}%`;
  marker.style.top = `${pendingBattedBall.y}%`;
  marker.classList.remove("hidden");

  if (chosen) chosen.textContent = `Gekozen: ${pendingBattedBall.zone}`;
}

function confirmBattedBallModal() {
  if (!pendingBattedBall) return;

  if (pendingBattedBall.x === "" || pendingBattedBall.y === "") {
    alert("Tik eerst op het veld waar de bal kwam.");
    return;
  }

  const extra = {
    battedBallX: pendingBattedBall.x,
    battedBallY: pendingBattedBall.y,
    battedBallZone: pendingBattedBall.zone,
    battedBallHardness: pendingBattedBall.hardness,
    battedBallHeight: pendingBattedBall.height
  };

  cancelBattedBallModal();
  savePitchFinal(extra);
}

function applyResult(result) {
  let plateAppearanceEnded = false;

  if (result === "Ball") {
    game.balls += 1;
    game.totalBalls += 1;
  }

  if (result === "HBP") {
    game.balls += 1;
    game.totalBalls += 1;
    plateAppearanceEnded = true;
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
    plateAppearanceEnded = true;
  }

  if (result === "Veld uit") {
    game.strikes += 1;
    game.totalStrikes += 1;
    addOut(false);
    plateAppearanceEnded = true;
  }

  if (result === "Strike out") {
    game.strikes += 1;
    game.totalStrikes += 1;
    addOut(false);
    plateAppearanceEnded = true;
  }

  if (game.balls >= 4) {
    plateAppearanceEnded = true;
  }

  if (game.strikes >= 3) {
    addOut(false);
    plateAppearanceEnded = true;
  }

  if (plateAppearanceEnded) {
    clearBatterCount(game.batterIndex);
    nextBatter(false, true);
    return;
  }

  saveCurrentBatterCount();
}

function getBatterPlateAppearancePitches(batter) {
  if (!batter) return [];

  const pitches = [];
  for (const pitch of (game.pitches || [])) {
    if (isPitchForBatter(pitch, batter)) {
      pitches.push(pitch);
      continue;
    }

    if (pitches.length) break;
  }

  return pitches;
}

function getCountAfterPitchSnapshot(pitch) {
  let balls = Number(pitch?.ballsBefore || 0);
  let strikes = Number(pitch?.strikesBefore || 0);
  const result = pitch?.result;

  if (result === "Ball" || result === "HBP") balls += 1;
  if (["Strike", "Swing"].includes(result)) strikes += 1;
  if (result === "Foul" && strikes < 2) strikes += 1;

  // Bij terminale resultaten wil je bij teruggaan vooral de count van die slagbeurt
  // kunnen herstellen. Daarom houden we hem op max 3-2 i.p.v. naar 0-0 te resetten.
  return {
    balls: Math.max(0, Math.min(3, balls)),
    strikes: Math.max(0, Math.min(2, strikes))
  };
}

function getCountAfterPitchesForBatter(batter) {
  const paPitches = getBatterPlateAppearancePitches(batter);

  if (!paPitches.length) {
    return { balls: 0, strikes: 0 };
  }

  // game.pitches is newest-first, dus paPitches[0] is de laatst gegooide pitch
  // van deze slagbeurt. De opgeslagen ballsBefore/strikesBefore zijn leidend.
  return getCountAfterPitchSnapshot(paPitches[0]);
}

function restoreCountForCurrentBatter() {
  const batter = game.lineup[game.batterIndex];
  const count = getCountAfterPitchesForBatter(batter);
  game.balls = count.balls;
  game.strikes = count.strikes;
}

async function deleteBatterPitchesFromGoogleSheet(batter, pitchTimestamps, pitchCount = 0) {
  if (!APPS_SCRIPT_URL) throw new Error("Google Sheets niet gekoppeld.");
  if (!batter) return;

  const resetPitchCount = Number(pitchCount || (pitchTimestamps ? pitchTimestamps.length : 0) || 0);
  if (!resetPitchCount) return;

  const payload = {
    type: "delete_batter_pitches",
    gameId: game.gameId || `${game.date}-${game.startTime}-${game.opponent}-${game.pitcherName}`,
    batterOrder: batter.order,
    batterName: batter.name,
    batterNumber: batter.number,
    resetPitchCount,
    pitchTimestamps: Array.isArray(pitchTimestamps) ? pitchTimestamps : []
  };

  // Reset moet direct naar Apps Script, niet via de offline queue.
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  setSyncStatus(`Reset slagvrouw verzonden naar Google Sheets (${resetPitchCount} pitch(es)).`, "ok");
}

function getBatterCountKey(index = game.batterIndex) {
  return String(Number(index || 0));
}

function ensureBatterCounts() {
  if (!game.batterCounts || typeof game.batterCounts !== "object") {
    game.batterCounts = {};
  }
}

function saveCurrentBatterCount() {
  ensureBatterCounts();
  game.batterCounts[getBatterCountKey()] = {
    balls: Number(game.balls || 0),
    strikes: Number(game.strikes || 0)
  };
}

function loadBatterCount(index = game.batterIndex) {
  ensureBatterCounts();
  const saved = game.batterCounts[getBatterCountKey(index)];
  const savedBalls = Number(saved?.balls || 0);
  const savedStrikes = Number(saved?.strikes || 0);

  if (saved && (savedBalls > 0 || savedStrikes > 0)) {
    game.balls = savedBalls;
    game.strikes = savedStrikes;
    return;
  }

  const batter = game.lineup[index];
  const reconstructed = getCountAfterPitchesForBatter(batter);

  game.balls = Number(reconstructed.balls || 0);
  game.strikes = Number(reconstructed.strikes || 0);

  game.batterCounts[getBatterCountKey(index)] = {
    balls: game.balls,
    strikes: game.strikes
  };
}

function clearBatterCount(index = game.batterIndex) {
  ensureBatterCounts();
  game.batterCounts[getBatterCountKey(index)] = { balls: 0, strikes: 0 };
}


function previousBatter(shouldSave = true) {
  if (game.batterIndex <= 0) {
    alert("Je staat al bij de eerste slagvrouw.");
    return;
  }

  saveCurrentBatterCount();
  game.batterIndex -= 1;
  loadBatterCount(game.batterIndex);
  game.pitchLocation = null;

  const dot = document.querySelector(".pitch-dot");
  if (dot) dot.remove();

  if (shouldSave) saveLocalGame();
  updateUI();
}

function nextBatter(shouldSave = true, allowWrap = false) {
  const lineupSize = Math.min(Number(game.activeLineupSize || 9), 9);

  if (!allowWrap) saveCurrentBatterCount();

  if (game.batterIndex >= lineupSize - 1) {
    if (!allowWrap) {
      alert("Je staat al bij de laatste slagvrouw.");
      return;
    }
    game.batterIndex = 0;
  } else {
    game.batterIndex += 1;
  }

  if (allowWrap) {
    clearBatterCount(game.batterIndex);
    resetCount(false);
  } else {
    loadBatterCount(game.batterIndex);
  }

  game.pitchLocation = null;

  const dot = document.querySelector(".pitch-dot");
  if (dot) dot.remove();

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
  clearBatterCount(game.batterIndex);
  if (shouldSave) saveLocalGame();
  updateUI();
}

function recalculateActivePitcherTotals() {
  const pitcherPitches = (game.pitches || []).filter(p => p.pitcherName === game.pitcherName);

  game.totalBalls = pitcherPitches.filter(p => ["Ball", "HBP"].includes(p.result)).length;
  game.totalStrikes = pitcherPitches.filter(p => isStrikeResult(p.result)).length;
  game.firstPitchStrikes = pitcherPitches.filter(p => p.firstPitch && isStrikeResult(p.result)).length;

  const outsFromSnapshots = pitcherPitches
    .map(p => Number(p.outsBefore || 0))
    .filter(n => Number.isFinite(n));

  const outResults = pitcherPitches.filter(p => isOutResult(p.result)).length;
  game.totalOuts = Math.max(outsFromSnapshots.length ? Math.max(...outsFromSnapshots) : 0, outResults);
  game.outs = game.totalOuts;

  restoreCountForCurrentBatter();
}

function isPitchForBatter(pitch, batter) {
  if (!pitch || !batter) return false;

  return Number(pitch.batterOrder) === Number(batter.order) &&
    String(pitch.batterName || "") === String(batter.name || "") &&
    String(pitch.batterNumber || "") === String(batter.number || "");
}

function resetCurrentBatter() {
  const batter = game.lineup[game.batterIndex];

  if (!batter) {
    alert("Geen slagvrouw geselecteerd.");
    return;
  }

  const currentPaPitches = getBatterPlateAppearancePitches(batter);
  const confirmed = confirm(
    `Reset ${batter.name || "deze slagvrouw"} naar 0-0?\n\nDe pitches van deze slagbeurt worden verwijderd uit de huidige game en ook uit Google Sheets gesynchroniseerd.`
  );

  if (!confirmed) return;

  const timestampsToDelete = currentPaPitches
    .map(p => String(p.timestamp || "").trim())
    .filter(Boolean);

  const timestampSet = new Set(timestampsToDelete);
  const beforeCount = (game.pitches || []).length;
  game.pitches = (game.pitches || []).filter(p => !timestampSet.has(String(p.timestamp || "").trim()));
  const removedCount = beforeCount - game.pitches.length;

  game.pitchLocation = null;
  const dot = document.querySelector(".pitch-dot");
  if (dot) dot.remove();

  clearBatterCount(game.batterIndex);
  recalculateActivePitcherTotals();
  saveLocalGame();
  updateUI();

  if (removedCount) {
    setSyncStatus(`${removedCount} pitch(es) lokaal verwijderd. Google Sheets wordt bijgewerkt...`, "loading");
    deleteBatterPitchesFromGoogleSheet(batter, timestampsToDelete, removedCount).catch(error => {
      console.error("Delete sync fout", error);
      setSyncStatus("Pitch(es) lokaal verwijderd, maar verwijderen uit Google Sheets kon nog niet starten.", "error");
    });
  } else {
    setSyncStatus(`${batter.name} staat opnieuw op 0-0. Geen pitches verwijderd.`, "ok");
  }
}

function undoPitch() {
  resetCurrentBatter();
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

async function resetGame() {
  if (!confirm("Wil je deze game afsluiten? Daarna staat hij bij 'Vorige games'.")) return;

  const pendingCount = await getOfflineQueueCount().catch(() => 0);
  if (pendingCount > 0) {
    const proceed = confirm(`Er staan nog ${pendingCount} item(s) lokaal te wachten op sync. De game wordt wel lokaal afgesloten en later gesynchroniseerd. Doorgaan?`);
    if (!proceed) return;
  }

  game.closed = true;
  game.closedAt = new Date().toISOString();

  upsertStoredGame(game);
  await sendGameStatusToGoogleSheet();

  showHome();
}

function getActivePitcherPitchCount() {
  if (!game.pitcherName) return 0;
  return (game.pitches || []).filter(p => p.pitcherName === game.pitcherName).length;
}


function getBattedBallHistoryText(pitch) {
  if (!pitch || !pitch.battedBallZone) return "";
  const parts = [
    pitch.battedBallZone,
    pitch.battedBallHardness,
    pitch.battedBallHeight
  ].filter(Boolean);

  return parts.length ? ` · ${parts.join(" · ")}` : "";
}


function getCurrentBatterBattedBalls() {
  const batter = game.lineup[game.batterIndex];
  if (!batter) return [];

  return (game.pitches || [])
    .filter(p => {
      return String(p.batterName || "") === String(batter.name || "") &&
        String(p.batterNumber || "") === String(batter.number || "") &&
        ["HIT", "Veld uit"].includes(p.result) &&
        p.battedBallZone;
    });
}

function renderPreviousBattedBall() {
  const title = document.getElementById("previousBattedTitle");
  const meta = document.getElementById("previousBattedMeta");
  const marker = document.getElementById("previousBattedMarker");
  if (!title || !meta || !marker) return;

  const last = getCurrentBatterBattedBalls()[0];

  if (!last) {
    title.textContent = "Nog geen geslagen bal bekend";
    meta.textContent = "Bij HIT of Veld uit wordt hier zichtbaar waar de bal kwam.";
    marker.classList.add("hidden");
    return;
  }

  title.textContent = `${last.result}: ${last.battedBallZone}`;
  meta.textContent = [
    last.battedBallHardness,
    last.battedBallHeight,
    last.pitchType
  ].filter(Boolean).join(" · ");

  const x = Number(last.battedBallX);
  const y = Number(last.battedBallY);

  if (Number.isFinite(x) && Number.isFinite(y)) {
    marker.style.left = `${Math.max(0, Math.min(100, x))}%`;
    marker.style.top = `${Math.max(0, Math.min(100, y))}%`;
    marker.classList.remove("hidden");
  } else {
    marker.classList.add("hidden");
  }
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
      <span><b>${p.batterName} #${p.batterNumber}</b><br>${p.pitchType} · ${p.result} · ${getReadableZone(p)}${getBattedBallHistoryText(p)}</span>
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
    const displayPoint = getDisplayPoint(p, "standard");
    dot.style.left = `${displayPoint.x}%`;
    dot.style.top = `${displayPoint.y}%`;
    dot.title = `${p.pitchType} · ${p.result}`;
    dot.textContent = index + 1;
    heatmap.appendChild(dot);
  });

  document.getElementById("batterPitchCount").textContent = batterPitches.length;
  document.getElementById("batterHitCount").textContent = batterPitches.filter(p => p.result === "HIT").length;
  document.getElementById("batterOutCount").textContent = batterPitches.filter(p => isOutResult(p.result)).length;
}

function formatInningsPitched(totalOuts) {
  return (Number(totalOuts || 0) / 3).toFixed(3);
}

function getPitchZone(x, y) {
  const zoneLeft = STRIKE_ZONE.left;
  const zoneRight = STRIKE_ZONE.right;
  const zoneTop = STRIKE_ZONE.top;
  const zoneBottom = STRIKE_ZONE.bottom;

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

  const payload = {
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
  };

  await queueGoogleSheetPayload("game_status", payload, "Game status");
}

async function sendPitchToGoogleSheet(pitch) {
  if (!game.appsScriptUrl) {
    setSyncStatus("Google Sheets niet gekoppeld.", "error");
    return;
  }

  const payload = {
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
  };

  await queueGoogleSheetPayload("pitch", payload, "Pitch");
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

      const speedItems = convertSheetRowsToSpeedTrainings(payload);
      saveStoredSpeedTrainings(speedItems);

      sheetSyncLoaded = true;
      setSyncStatus(`Google Sheets geladen: ${games.length} games · ${speedItems.length} speed-metingen uit datasheet.`, "ok");

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

  const normalizeHeaderKey = value =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const getLoose = (record, names) => {
    const wanted = names.map(normalizeHeaderKey);

    for (const key of Object.keys(record)) {
      if (key.startsWith("_")) continue;
      if (wanted.includes(normalizeHeaderKey(key)) && record[key] !== undefined && record[key] !== "") {
        return record[key];
      }
    }

    return "";
  };

  const normalizeCell = value =>
    String(value || "")
      .trim()
      .toLowerCase();

  const normalizeLoose = value =>
    normalizeHeaderKey(value);

  const isNumberInPercentRange = value => {
    if (value === "" || value === null || value === undefined) return false;
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100;
  };

  const battedZoneValues = [
    "Links", "Links - Center", "Center", "Rechts - Center", "Rechts",
    "Derde honk", "Kortstop", "Pitcher", "Tweede honk", "Eerste honk", "Catcher",
    "3e honk", "1e honk"
  ];

  const battedSpeedValues = ["Hard", "Normaal", "Zacht", "Snel", "Zeer zacht", "Gemiddeld", "Zeer hard", "Keihard"];
  const battedHeightValues = ["Hoog", "Line Drive", "Laag", "Grondbal", "Middel", "Heel hoog", "Ongrijpbaar"];

  const findKnownValue = (values, allowed) => {
    const allowedNorm = allowed.map(normalizeLoose);
    for (let i = 0; i < values.length; i += 1) {
      if (allowedNorm.includes(normalizeLoose(values[i]))) {
        return { index: i, value: values[i] };
      }
    }
    return { index: -1, value: "" };
  };

  const inferBattedBallFromRecord = record => {
    const indexed = Object.keys(record)
      .filter(key => /^_\d+$/.test(key))
      .map(key => ({
        index: Number(key.slice(1)),
        value: record[key]
      }))
      .sort((a, b) => a.index - b.index);

    const values = indexed.map(item => item.value);
    const tailStart = Math.max(0, values.length - 12);
    const tail = values.slice(tailStart);

    const zoneMatch = findKnownValue(tail, battedZoneValues);
    const speedMatch = findKnownValue(tail, battedSpeedValues);
    const heightMatch = findKnownValue(tail, battedHeightValues);

    let x = "";
    let y = "";

    if (zoneMatch.index >= 2) {
      const possibleX = tail[zoneMatch.index - 2];
      const possibleY = tail[zoneMatch.index - 1];

      if (isNumberInPercentRange(possibleX) && isNumberInPercentRange(possibleY)) {
        x = possibleX;
        y = possibleY;
      }
    }

    if ((!x || !y) && speedMatch.index >= 3) {
      const possibleX = tail[speedMatch.index - 3];
      const possibleY = tail[speedMatch.index - 2];

      if (isNumberInPercentRange(possibleX) && isNumberInPercentRange(possibleY)) {
        x = possibleX;
        y = possibleY;
      }
    }

    return {
      x,
      y,
      zone: zoneMatch.value || "",
      hardness: speedMatch.value || "",
      height: heightMatch.value || ""
    };
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
      walk: parseBool(get(record, ["Walk", "walk"], 25)),
      battedBallX: (() => {
        const inferred = inferBattedBallFromRecord(record);
        return getLoose(record, [
          "Batted Ball X", "battedBallX", "BattedBallX", "Batted X", "Hit X",
          "Spray X", "Geslagen Bal X", "GeslagenBalX", "Bal X", "Locatie X"
        ]) || inferred.x;
      })(),
      battedBallY: (() => {
        const inferred = inferBattedBallFromRecord(record);
        return getLoose(record, [
          "Batted Ball Y", "battedBallY", "BattedBallY", "Batted Y", "Hit Y",
          "Spray Y", "Geslagen Bal Y", "GeslagenBalY", "Bal Y", "Locatie Y"
        ]) || inferred.y;
      })(),
      battedBallZone: (() => {
        const inferred = inferBattedBallFromRecord(record);
        return getLoose(record, [
          "Batted Ball Zone", "battedBallZone", "BattedBallZone", "Batted Zone",
          "Hit Zone", "Spray Zone", "Geslagen Bal Zone", "GeslagenBalZone",
          "Bal Zone", "Veld Zone", "Locatie", "Zone Geslagen Bal"
        ]) || inferred.zone;
      })(),
      battedBallHardness: (() => {
        const inferred = inferBattedBallFromRecord(record);
        return getLoose(record, [
          "Batted Ball Hardness", "battedBallHardness", "BattedBallHardness",
          "Hardheid", "Snelheid", "Contact Snelheid", "Bal Snelheid"
        ]) || inferred.hardness;
      })(),
      battedBallHeight: (() => {
        const inferred = inferBattedBallFromRecord(record);
        return getLoose(record, [
          "Batted Ball Height", "battedBallHeight", "BattedBallHeight",
          "Hoogte", "Bal Hoogte", "Contact Hoogte"
        ]) || inferred.height;
      })()
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


