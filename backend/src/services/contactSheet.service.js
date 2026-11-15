// A workspace's contact-and-price list kept in Google Sheets.
//
// The link is saved once. From then on "Import from sheet" reads the tab as it
// stands at that moment and runs it through the very same import as an
// uploaded CSV (services/contacts.service.js importContacts): new numbers are
// added, existing ones keep their name and take the sheet's extra columns
// (prices). Change tomorrow's prices in the sheet, import again, and the next
// campaign quotes them.
//
// The saved link lives in WorkspaceIntegration (provider "contact-sheet"), the
// table that already holds per-workspace connections, so there is no schema
// change. How the sheet is read is in lib/googleSheet.js.

import { prisma } from '../lib/prisma.js';
import { decrypt, encrypt } from '../lib/encryption.js';
import { parseSheetLink, readPublicCsv, readWithToken } from '../lib/googleSheet.js';
import { refreshAccessToken } from '../lib/oauthProviders.js';
import { importContacts } from './contacts.service.js';

const PROVIDER = 'contact-sheet';
const GOOGLE = 'google';

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const findRow = (workspaceId, provider) =>
  prisma.workspaceIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });

async function googleConnection(workspaceId) {
  const row = await findRow(workspaceId, GOOGLE);
  return row?.status === 'CONNECTED' && row.encryptedCredentials ? row : null;
}

/** The saved sheet, what the last import did, and whether Google is connected. */
export async function getContactSheet(workspaceId) {
  const [row, google] = await Promise.all([findRow(workspaceId, PROVIDER), googleConnection(workspaceId)]);
  const config = row?.config && typeof row.config === 'object' ? row.config : {};
  return {
    url: config.url || null,
    googleConnected: Boolean(google),
    lastImportedAt: config.lastImportedAt || null,
    lastResult: config.lastResult || null,
    lastError: config.lastError || null,
  };
}

/** Saves (or, with an empty link, forgets) the workspace's sheet. */
export async function saveContactSheet(workspaceId, link) {
  const url = String(link || '').trim();
  if (!url) {
    await prisma.workspaceIntegration.deleteMany({ where: { workspaceId, provider: PROVIDER } });
    return getContactSheet(workspaceId);
  }
  const { spreadsheetId, gid } = parseSheetLink(url); // 400 with a readable reason
  const config = { url, spreadsheetId, gid };
  await prisma.workspaceIntegration.upsert({
    where: { workspaceId_provider: { workspaceId, provider: PROVIDER } },
    create: { workspaceId, provider: PROVIDER, type: 'sheet', status: 'CONNECTED', config },
    // A new link starts with a clean history: the old sheet's last result is not this one's.
    update: { type: 'sheet', status: 'CONNECTED', config },
  });
  return getContactSheet(workspaceId);
}

// The tab through the connected Google account. An expired access token is
// refreshed once and the new one stored, so the connection keeps working
// without anyone reconnecting it.
async function readThroughAccount(connection, target) {
  const tokens = JSON.parse(decrypt(connection.encryptedCredentials));
  try {
    return await readWithToken(target, tokens.access_token);
  } catch (err) {
    if (err.status !== 401 || !tokens.refresh_token) throw err;
  }
  const fresh = await refreshAccessToken(GOOGLE, tokens.refresh_token);
  const merged = { ...tokens, ...fresh, refresh_token: fresh.refresh_token || tokens.refresh_token };
  await prisma.workspaceIntegration.update({
    where: { id: connection.id },
    data: { encryptedCredentials: encrypt(JSON.stringify(merged)) },
  });
  return readWithToken(target, merged.access_token);
}

// The sheet as CSV: through the connected Google account when there is one,
// otherwise (or if that fails) through the sheet's view-only link.
async function readSheet(workspaceId, target) {
  const connection = await googleConnection(workspaceId);
  let accountError = null;
  if (connection) {
    try {
      return { csv: await readThroughAccount(connection, target), via: 'account' };
    } catch (err) {
      accountError = err;
      console.warn(`[ContactSheet] Reading through the Google account failed: ${err.message}`);
    }
  }
  try {
    return { csv: await readPublicCsv(target), via: 'link' };
  } catch (err) {
    if (err.code === 'SHEET_NOT_FOUND') throw fail(400, 'Google could not find that sheet. Check the link, or that the sheet was not deleted.');
    if (connection) {
      throw fail(400, 'The connected Google account cannot open this sheet'
        + `${accountError?.message ? ` (${accountError.message})` : ''}. `
        + 'Share the sheet with that account, or set its sharing to "Anyone with the link can view".');
    }
    throw fail(400, 'This sheet is private. Connect Google under Integrations, '
      + 'or set the sheet\'s sharing to "Anyone with the link can view".');
  }
}

/**
 * Imports the saved sheet as it is right now. Returns what a CSV upload
 * returns ({ imported, updated, invalid, totalRows, attributeKeys, contacts })
 * plus `via`: "account" or "link".
 */
export async function importContactSheet(workspaceId) {
  const row = await findRow(workspaceId, PROVIDER);
  const config = row?.config && typeof row.config === 'object' ? row.config : null;
  if (!config?.spreadsheetId) throw fail(400, 'Save your Google Sheet link first.');

  const remember = (patch) => prisma.workspaceIntegration.update({
    where: { id: row.id },
    data: { config: { ...config, ...patch } },
  });

  let result;
  let via;
  try {
    const read = await readSheet(workspaceId, { spreadsheetId: config.spreadsheetId, gid: config.gid || null });
    via = read.via;
    if (!read.csv.trim()) throw fail(400, 'That tab is empty. Check the link points at the tab with your contacts.');
    result = await importContacts(workspaceId, Buffer.from(read.csv, 'utf8'));
    if (result.totalRows > 0 && result.contacts.length === 0) {
      throw fail(400, 'No phone numbers were found. The tab needs a "phone" column with numbers including the country code.');
    }
  } catch (err) {
    await remember({ lastError: err.message }).catch(() => {});
    throw err;
  }

  await remember({
    lastImportedAt: new Date().toISOString(),
    lastError: null,
    lastResult: {
      imported: result.imported, updated: result.updated, invalid: result.invalid,
      contacts: result.contacts.length, attributeKeys: result.attributeKeys, via,
    },
  });
  return { ...result, via };
}
