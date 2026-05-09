function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders_(sheet);

  const data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    new Date(),
    data.gameId || "",
    data.date || "",
    data.startTime || "",
    data.opponent || "",
    data.pitcherName || "",
    data.batterOrder || "",
    data.batterName || "",
    data.batterNumber || "",
    data.x || "",
    data.y || "",
    data.zoneHorizontal || "",
    data.zoneVertical || "",
    data.zoneLabel || "",
    data.pitchType || "",
    data.result || "",
    data.ballsBefore || 0,
    data.strikesBefore || 0,
    data.outsBefore || 0,
    data.firstPitch || false,
    data.firstPitchStrike || false,
    data.totalBalls || 0,
    data.totalStrikes || 0,
    data.totalOuts || 0,
    data.inningsPitched || "",
    data.walk || false
  ]);

  return ContentService.createTextOutput("OK");
}

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders_(sheet);

  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const rows = values.slice(1);

  const payload = {
    headers: headers,
    rows: rows
  };

  const callback = e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(payload) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureHeaders_(sheet) {
  const headers = [
    "Timestamp",
    "Game ID",
    "Datum",
    "Starttijd",
    "Tegenstander",
    "Pitcher",
    "Batter Order",
    "Slagvrouw",
    "Rugnummer",
    "X",
    "Y",
    "Zone Horizontal",
    "Zone Vertical",
    "Zone Label",
    "Pitch Type",
    "Resultaat",
    "Balls Before",
    "Strikes Before",
    "Outs Before",
    "First Pitch",
    "First Pitch Strike",
    "Total Balls",
    "Total Strikes",
    "Total Outs",
    "Innings Pitched",
    "Walk"
  ];

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow[0] === "Timestamp" && firstRow[1] === "Game ID";

  if (!hasHeaders) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}
