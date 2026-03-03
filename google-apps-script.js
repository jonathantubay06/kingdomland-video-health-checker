/**
 * Google Apps Script — Kingdomland Spreadsheet Updater
 *
 * Deploy this as a Web App to allow the cross-check tool to update
 * the Status column in your Google Spreadsheet automatically.
 *
 * SETUP:
 *   1. Open your spreadsheet in Google Sheets
 *   2. Go to Extensions → Apps Script
 *   3. Delete any existing code and paste this entire file
 *   4. Click Deploy → New deployment
 *   5. Select type: "Web app"
 *   6. Set "Execute as": Me
 *   7. Set "Who has access": Anyone
 *   8. Click Deploy and copy the web app URL
 *   9. Add it to your .env file as GSHEET_WEBAPP_URL=<your-url>
 *  10. Restart the dashboard server
 */

/**
 * Handle POST requests from the cross-check tool.
 * Expects JSON body: { changes: [{ rowIndex: number, newStatus: string }] }
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Find the "Status" column dynamically
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var statusCol = -1;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].toString().trim().toLowerCase() === 'status') {
        statusCol = i + 1; // 1-indexed
        break;
      }
    }

    if (statusCol === -1) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Status column not found in spreadsheet' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var updated = 0;
    var changes = data.changes || [];

    for (var j = 0; j < changes.length; j++) {
      var change = changes[j];
      if (change.rowIndex && change.newStatus) {
        sheet.getRange(change.rowIndex, statusCol).setValue(change.newStatus);
        updated++;
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, updated: updated }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing the deployment).
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Kingdomland Spreadsheet Updater is running. Send POST requests to update statuses.',
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
