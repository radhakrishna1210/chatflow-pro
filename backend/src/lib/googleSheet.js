// Reading one tab of a Google Sheet as CSV, so a contact-and-price list kept
// in Google Sheets can be imported exactly like an uploaded CSV file.
//
// Two ways in, tried in this order by the caller:
//
//   readWithToken   through the workspace's connected Google account (the
//                   Sheets API). Works for a private sheet.
//   readPublicCsv   Google's own CSV export of the tab. Works only when the
//                   sheet is shared as "Anyone with the link can view".
//
// Only docs.google.com / sheets.googleapis.com are ever contacted, with the
// spreadsheet id taken from the link by a strict pattern — a pasted link can
// never point this at another host.

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * { spreadsheetId, gid } from a Google Sheets link. `gid` is the tab (null =
 * the first tab). Throws a 400 with a readable message for anything else.
 */
export function parseSheetLink(link) {
  let url;
  try {
    url = new URL(String(link || '').trim());
  } catch {
    throw fail(400, 'Paste the full link to your Google Sheet (it starts with https://docs.google.com/spreadsheets/).');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw fail(400, 'That is not a Google Sheets link. It should start with https://docs.google.com/spreadsheets/.');
  }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(url.pathname);
  if (!match) {
    throw fail(400, 'That link does not point at a sheet. Open the sheet and copy the link from the address bar.');
  }
  // The tab is in the fragment (#gid=123) when copied from the address bar,
  // or in the query (?gid=123) in some share links.
  const gidMatch = /(?:^|[#&?])gid=(\d+)/.exec(`${url.hash}&${url.search}`);
  return { spreadsheetId: match[1], gid: gidMatch ? gidMatch[1] : null };
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Rows of cells (as the Sheets API returns them) → CSV text. */
export function rowsToCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const width = list.reduce((n, r) => Math.max(n, Array.isArray(r) ? r.length : 0), 0);
  return list
    .map((r) => Array.from({ length: width }, (_, i) => csvCell(Array.isArray(r) ? r[i] : '')).join(','))
    .join('\r\n');
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw fail(400, 'That sheet is too large to import (over 5 MB).');
  const body = await res.text();
  if (body.length > MAX_BYTES) throw fail(400, 'That sheet is too large to import (over 5 MB).');
  return { res, body };
}

/**
 * The tab as CSV through Google's export link. Needs the sheet shared as
 * "Anyone with the link can view"; a private sheet answers with a sign-in
 * page, which is reported as such rather than imported as rows.
 */
export async function readPublicCsv({ spreadsheetId, gid }) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  const { res, body } = await get(url);
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !/text\/csv/i.test(type) || /^\s*<(!doctype|html)/i.test(body)) {
    const e = fail(400, 'Google did not let us read that sheet.');
    e.code = res.status === 404 ? 'SHEET_NOT_FOUND' : 'SHEET_PRIVATE';
    throw e;
  }
  return body;
}

/**
 * The tab as CSV through the Sheets API with an access token. Values come as
 * shown in the sheet (so a formula's result, not the formula). Throws with
 * `status` 401 when the token is expired or revoked, so the caller can refresh.
 */
export async function readWithToken({ spreadsheetId, gid }, accessToken) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const meta = await get(`${api}?fields=sheets.properties(sheetId,title)`, auth);
  if (!meta.res.ok) throw apiError(meta);
  const tabs = (JSON.parse(meta.body).sheets || []).map((s) => s.properties);
  const tab = gid ? tabs.find((t) => String(t.sheetId) === String(gid)) : tabs[0];
  if (!tab) throw fail(400, 'That tab no longer exists in the sheet. Copy the link again from the tab you want.');

  const range = encodeURIComponent(`'${String(tab.title).replace(/'/g, "''")}'`);
  const values = await get(`${api}/values/${range}?valueRenderOption=FORMATTED_VALUE`, auth);
  if (!values.res.ok) throw apiError(values);
  return rowsToCsv(JSON.parse(values.body).values || []);
}

function apiError({ res, body }) {
  let message = '';
  try { message = JSON.parse(body)?.error?.message || ''; } catch { /* not JSON */ }
  const e = fail(res.status === 401 ? 401 : 400, message || `Google answered ${res.status}.`);
  if (res.status === 403) e.code = 'SHEET_FORBIDDEN';
  if (res.status === 404) e.code = 'SHEET_NOT_FOUND';
  return e;
}
