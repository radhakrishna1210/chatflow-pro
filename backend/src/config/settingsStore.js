// The in-memory override cache, and the list of names an override may carry.
//
// This module imports nothing. That is deliberate: config/env.js reads it on
// every property access, and the service that fills it needs Prisma and the
// encryption helper — both of which read `env` themselves. Putting the cache
// in a leaf module is what keeps `env → settings → encryption → env` from
// becoming a boot-time cycle, in which `env` is still uninitialised when
// encryption.js derives its key and the process dies before it can log why.

// Only these may be overridden from the database. An override *substitutes*
// for an environment variable, it never introduces one — so a row cannot
// redirect DATABASE_URL, mint its own JWT secrets, or swap ENCRYPTION_KEY,
// which is the key the overrides themselves are encrypted with.
export const MANAGED_SETTING_KEYS = Object.freeze([
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'META_SYSTEM_USER_TOKEN',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_BUSINESS_ID',
  'META_WABA_ID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
]);

const MANAGED = new Set(MANAGED_SETTING_KEYS);

export const isManagedSettingKey = (key) => typeof key === 'string' && MANAGED.has(key);

// Values arrive from the database as strings; the zod schema in env.js has
// already coerced the same names coming from process.env, so an override has
// to be coerced the same way or SMTP_PORT reaches nodemailer as "587".
const COERCE = {
  SMTP_PORT: (value) => {
    const port = Number(value);
    return Number.isFinite(port) ? port : undefined;
  },
};

let cache = Object.create(null);

// undefined means "no override" — the caller falls through to the environment.
export function getSystemSetting(key) {
  if (!isManagedSettingKey(key)) return undefined;
  const value = cache[key];
  if (value === undefined || value === null || value === '') return undefined;
  return COERCE[key] ? COERCE[key](value) : value;
}

export function setSystemSettings(values) {
  const next = Object.create(null);
  for (const [key, value] of Object.entries(values || {})) {
    if (isManagedSettingKey(key) && typeof value === 'string' && value !== '') next[key] = value;
  }
  cache = next;
}

export function systemSettingKeys() {
  return Object.keys(cache);
}
