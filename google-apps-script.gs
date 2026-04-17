/**
 * ManeLine — Google Apps Script Web App
 * Receives webhook POSTs from the Cloudflare Worker and appends a row
 * to the connected Google Sheet.
 *
 * ----------------------------------------------------------------
 * ONE-TIME SETUP
 * ----------------------------------------------------------------
 * 1. Create a new Google Sheet. Name it e.g. "ManeLine Waitlist".
 * 2. Sheet1 — add this header row in row 1:
 *      timestamp | event | user_id | email | full_name | phone | location | discipline | marketing_opt_in
 * 3. Sheet1 extensions -> Apps Script. Paste this file in Code.gs.
 * 4. In the Apps Script editor, replace SHARED_SECRET below with the
 *    same secret you will put into your Cloudflare Worker env
 *    (see wrangler.toml and README.md).
 * 5. Deploy -> New deployment -> Type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Copy the Web App URL — this goes into the Worker as
 *    GOOGLE_APPS_SCRIPT_URL.
 * 6. Re-deploy any time you change this file (or use "Manage deployments"
 *    and edit the existing one to keep the same URL).
 */

// Replace this with a long random string. Must match the Worker's
// GOOGLE_APPS_SCRIPT_SECRET env variable.
const SHARED_SECRET = 'REPLACE_ME_WITH_A_LONG_RANDOM_STRING';

// If you want writes to go to a specific sheet tab, set its name here.
const SHEET_NAME = 'Sheet1';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');

    // Secret check — the Worker sends this in the JSON body.
    if (body.secret !== SHARED_SECRET) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const row = body.row || {};
    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(SHEET_NAME) || SpreadsheetApp.getActiveSheet();

    sheet.appendRow([
      new Date(),
      body.event || 'insert',
      row.id || '',
      row.email || '',
      row.full_name || '',
      row.phone || '',
      row.location || '',
      row.discipline || '',
      row.marketing_opt_in === false ? 'no' : 'yes'
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Optional: GET returns a heartbeat so you can test the URL in a browser.
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'maneline-sheets-mirror' }))
    .setMimeType(ContentService.MimeType.JSON);
}
