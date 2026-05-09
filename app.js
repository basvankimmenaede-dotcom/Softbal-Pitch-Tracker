const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyzuppIUnIOFCqKuIfSHLqByP-pGXgANZKaAWHnh1WrUrUx_XxoSAaD51EBk0p_C07F-Q/exec";
let sitePassword = "";
let isAuthenticated = false;


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

const pitchTypeOptions = ["Fastball", "Slowball", "Overig"];
const resultOptions = ["Ball", "Strike", "Swing", "Foul", "HIT", "Out"];

const STRIKE_ZONE = {
  // Deze waarden passen bij de getekende strikezone in het "Tik waar de bal kwam"-veld.
  // Alles buiten deze zone wordt "Wijd".
  left: 54,
  right: 92,
  top: 18,
  bottom: 72
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

  let horizontal = "Middle";
  if (relativeX <= 0.25) {
    horizontal = "Inside";
  } else if (relativeX >= 0.75) {
    horizontal = "Outside";
  }

  let vertical = "Midden";
  if (relativeY <= 0.25) {
    vertical = "Hoog";
  } else if (relativeY >= 0.75) {
    vertical = "Laag";
  }

  if (horizontal === "Middle" && vertical === "Midden") {
    return "Middle-middle";
  }

  return `${vertical} ${horizontal}`;
}


function init() {
  console.log("OG Pitching Tracker geladen");
}

window.onload = init;


window.verifySitePassword = async function verifySitePassword() {
  const input = document.getElementById("sitePasswordInput");
  const error = document.getElementById("loginError");
  const enteredPassword = String(input?.value || "").trim();

  try {
    const payload = await loadJsonp(APPS_SCRIPT_URL);
    const correctPassword = String(payload?.sitePassword || "").trim();

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

      if (typeof setActiveScreen === "function") {
        setActiveScreen("homeScreen");
      } else {
        document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
        document.getElementById("homeScreen")?.classList.add("active");
      }

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

