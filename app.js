const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyzuppIUnIOFCqKuIfSHLqByP-pGXgANZKaAWHnh1WrUrUx_XxoSAaD51EBk0p_C07F-Q/exec";
let sitePassword = "";
let isAuthenticated = false;

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
