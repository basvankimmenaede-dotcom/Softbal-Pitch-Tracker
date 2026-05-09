const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyzuppIUnIOFCqKuIfSHLqByP-pGXgANZKaAWHnh1WrUrUx_XxoSAaD51EBk0p_C07F-Q/exec";
let sitePassword = "";
let isAuthenticated = false;

const pitchTypeOptions = ["Fastball", "Slowball", "Overig"];
const resultOptions = ["Ball", "Strike", "Swing", "Foul", "HIT", "Out"];

function init() {
  console.log("OG Pitching Tracker geladen");
}

window.onload = init;
