import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { MANAGED_SETTING_KEYS, isManagedSettingKey, setSystemSettings, systemSettingKeys } from '../config/settingsStore.js';

// Platform credentials held in the database instead of the process
// environment, so the super admin can rotate a key without a redeploy.
//
// The cache itself lives in config/settingsStore.js, which imports nothing —
// see the note there for why. This module owns the database and crypto side of
// it: load at boot, decrypt into the cache, write back through the same AES key
// that protects WhatsApp access tokens.

// What a masked value looks like coming back from the UI. The screen never
// receives a secret in full, so it cannot send one back either — a field the
// admin did not touch arrives as its own mask and must be left alone rather
// than saved literally, which would overwrite a working key with "sk-1...4f2a".
const looksMasked = (value, masked) => value === '********' || (masked != null && value === masked);

export async function loadPlatformSettings() {
  try {
    const rows = await prisma.systemSetting.findMany();
    const next = {};
    let unreadable = 0;
    for (const row of rows) {
      if (!isManagedSettingKey(row.key)) continue;
      try {
        next[row.key] = decrypt(row.value);
      } catch (err) {
        // A value encrypted under a different ENCRYPTION_KEY cannot be
        // recovered. Skipping it falls back to the environment variable, which
        // is a working configuration; keeping the ciphertext would hand a
        // corrupt "key" to Gemini or Meta and fail every call with something
        // that looks like an outage.
        unreadable += 1;
        console.error(`[Settings] Could not decrypt ${row.key} — falling back to the environment.`, err.message);
      }
    }
    setSystemSettings(next);
    console.log(
      `[Settings] Loaded ${Object.keys(next).length} override(s) from the database`
      + `${unreadable ? `, ${unreadable} unreadable` : ''}.`,
    );
  } catch (err) {
    // Never fatal: the app boots on its environment variables exactly as it
    // did before this feature existed.
    console.error('[Settings] Could not load system settings:', err.message);
  }
}

// Applies a partial update. Keys absent from the object are untouched, a
// masked value means "unchanged", and an empty string clears the override so
// the environment variable takes over again.
export async function updateSettings(input = {}) {
  const masked = await getAllSettings();
  const changed = [];
  const cleared = [];

  for (const key of Object.keys(input)) {
    if (!isManagedSettingKey(key)) continue;
    const raw = input[key];
    if (raw === undefined || raw === null) continue;

    const value = String(raw).trim();
    if (looksMasked(value, masked[key])) continue;

    if (value === '') {
      await prisma.systemSetting.deleteMany({ where: { key } });
      cleared.push(key);
      continue;
    }

    const encrypted = encrypt(value);
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: encrypted },
      create: { key, value: encrypted },
    });
    changed.push(key);
  }

  await loadPlatformSettings();
  // Names only — never values.
  console.log(`[Settings] Updated ${changed.length} setting(s)${changed.length ? `: ${changed.join(', ')}` : ''}`
    + `${cleared.length ? ` · cleared: ${cleared.join(', ')}` : ''}`);
  return { updated: changed, cleared };
}

const isSecret = (key) => /KEY|TOKEN|SECRET|PASSWORD/.test(key);

// Enough for the admin screen to show what is configured, without ever
// returning a credential. A secret comes back as its first and last four
// characters; anything short enough for that to give it away is fully masked.
export async function getAllSettings() {
  const { env } = await import('../config/env.js');
  const overridden = new Set(systemSettingKeys());
  const out = {};

  for (const key of MANAGED_SETTING_KEYS) {
    const value = String(env[key] ?? '');
    if (!value) { out[key] = ''; continue; }
    out[key] = isSecret(key)
      ? (value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : '********')
      : value;
  }

  // Which of them are coming from the database rather than the environment, so
  // the screen can say where a value is actually being read from.
  out._sources = Object.fromEntries(
    MANAGED_SETTING_KEYS.map((key) => [key, overridden.has(key) ? 'database' : (env[key] ? 'environment' : 'unset')]),
  );
  return out;
}
