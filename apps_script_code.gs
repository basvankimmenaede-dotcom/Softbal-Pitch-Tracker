function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders_(sheet);

  const data = JSON.parse(e.postData.contents);
  const rowType = data.type || "pitch";

  if (rowType === "game_event") {
    sheet.appendRow([
      "game_event",
      new Date(),
      data.gameId || "",
      data.date || "",
      data.startTime || "",
      data.opponent || "",
      data.pitcherName || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      data.eventType || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      data.totalOuts || 0,
      "",
      "",
      data.closed || false,
      data.closedAt || "",
      "",
      "",
      data.earnedRuns || 0,
      data.unearnedRuns || 0,
      data.runnerOuts || 0
    ]);
    return ContentService.createTextOutput("OK");
  }

  if (rowType === "game_status") {
    sheet.appendRow([
      "game_status",
      new Date(),
      data.gameId || "",
      data.date || "",
      data.startTime || "",
      data.opponent || "",
      data.pitcherName || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      data.totalBalls || 0,
      data.totalStrikes || 0,
      data.totalOuts || 0,
      data.inningsPitched || "",
      "",
      data.closed || true,
      data.closedAt || "",
      data.totalPitches || "",
      data.firstPitchStrikes || "",
      "",
      "",
      ""
    ]);
    return ContentService.createTextOutput("OK");
  }

  sheet.appendRow([
    "pitch",
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
    data.walk || false,
    data.closed || false,
    data.closedAt || "",
    data.totalPitches || "",
    data.firstPitchStrikes || "",
    "",
    "",
    "",
    data.battedBallX || "",
    data.battedBallY || "",
    data.battedBallZone || "",
    data.battedBallHardness || "",
    data.battedBallHeight || ""
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
    "Row Type",
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
    "Walk",
    "Closed",
    "Closed At",
    "Total Pitches",
    "First Pitch Strikes",
    "Earned Runs",
    "Unearned Runs",
    "Runner Outs",
    "Batted Ball X",
    "Batted Ball Y",
    "Batted Ball Zone",
    "Batted Ball Hardness",
    "Batted Ball Height"
  ];

  const existingLastCol = Math.max(sheet.getLastColumn(), headers.length);
  const firstRow = sheet.getRange(1, 1, 1, existingLastCol).getValues()[0];
  const hasHeaders = firstRow[0] === "Row Type" || (firstRow[0] === "Timestamp" && firstRow[1] === "Game ID");

  if (!hasHeaders) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  // Als de oude headerstructuur al bestaat, niet destructief overschrijven.
  // Nieuwe rijen worden met Row Type op kolom A geschreven; de website kan beide formats lezen.
  if (firstRow[0] === "Row Type") {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}
