import { prisma } from './prisma.js';

// Contact phone numbers, normalised to E.164 ("+919876543210") on every write.
//
// Contact is unique on (workspaceId, phoneNumber), but that only prevents
// duplicates when every path writes the same spelling. "9876543210",
// "09876543210", "+91 98765 43210" and Meta's "919876543210" are one person and
// used to be four contacts. A bare national number has no country code of its
// own, so the workspace's default country supplies it.
//
// There is no libphonenumber here: the table below carries each country's
// calling code and the length of a national (significant) number, which is
// enough to tell "9876543210" (national, add +91) from "919876543210" (already
// international) without guessing.

export const PHONE_COUNTRIES = {
  IN: { name: 'India', code: '91', nsn: [10] },
  US: { name: 'United States', code: '1', nsn: [10] },
  CA: { name: 'Canada', code: '1', nsn: [10] },
  GB: { name: 'United Kingdom', code: '44', nsn: [10] },
  AE: { name: 'United Arab Emirates', code: '971', nsn: [8, 9] },
  SA: { name: 'Saudi Arabia', code: '966', nsn: [9] },
  QA: { name: 'Qatar', code: '974', nsn: [8] },
  KW: { name: 'Kuwait', code: '965', nsn: [8] },
  OM: { name: 'Oman', code: '968', nsn: [8] },
  BH: { name: 'Bahrain', code: '973', nsn: [8] },
  SG: { name: 'Singapore', code: '65', nsn: [8] },
  MY: { name: 'Malaysia', code: '60', nsn: [9, 10] },
  ID: { name: 'Indonesia', code: '62', nsn: [9, 10, 11, 12] },
  PH: { name: 'Philippines', code: '63', nsn: [10] },
  TH: { name: 'Thailand', code: '66', nsn: [9] },
  HK: { name: 'Hong Kong', code: '852', nsn: [8] },
  JP: { name: 'Japan', code: '81', nsn: [10] },
  CN: { name: 'China', code: '86', nsn: [11] },
  PK: { name: 'Pakistan', code: '92', nsn: [10] },
  BD: { name: 'Bangladesh', code: '880', nsn: [10] },
  LK: { name: 'Sri Lanka', code: '94', nsn: [9] },
  NP: { name: 'Nepal', code: '977', nsn: [10] },
  AU: { name: 'Australia', code: '61', nsn: [9] },
  NZ: { name: 'New Zealand', code: '64', nsn: [8, 9, 10] },
  DE: { name: 'Germany', code: '49', nsn: [10, 11] },
  FR: { name: 'France', code: '33', nsn: [9] },
  ES: { name: 'Spain', code: '34', nsn: [9] },
  IT: { name: 'Italy', code: '39', nsn: [9, 10] },
  NL: { name: 'Netherlands', code: '31', nsn: [9] },
  ZA: { name: 'South Africa', code: '27', nsn: [9] },
  NG: { name: 'Nigeria', code: '234', nsn: [10] },
  KE: { name: 'Kenya', code: '254', nsn: [9] },
  EG: { name: 'Egypt', code: '20', nsn: [10] },
  BR: { name: 'Brazil', code: '55', nsn: [10, 11] },
  MX: { name: 'Mexico', code: '52', nsn: [10] },
};

export const DEFAULT_PHONE_COUNTRY = 'IN';

const countryOf = (country) => PHONE_COUNTRIES[String(country || '').toUpperCase()] || PHONE_COUNTRIES[DEFAULT_PHONE_COUNTRY];

// E.164: a country code that does not start with 0, at most 15 digits in all.
const E164_DIGITS = /^[1-9]\d{6,14}$/;

/**
 * Normalises a phone number to E.164, or returns null when it cannot be one.
 *
 *   "+91 98765-43210"  -> "+919876543210"   explicit international
 *   "0091 9876543210"  -> "+919876543210"   00 international prefix
 *   "09876543210"      -> "+919876543210"   trunk 0 + national number
 *   "9876543210"       -> "+919876543210"   national number, country added
 *   "919876543210"     -> "+919876543210"   already carries the code
 *
 * `international: true` is for sources that only ever send international
 * digits without the "+" (Meta webhooks): applying the national rule there
 * would turn a 10-digit foreign number into a +91 one.
 */
export function toE164(raw, { country = DEFAULT_PHONE_COUNTRY, international = false } = {}) {
  const str = String(raw ?? '').trim();
  const digits = str.replace(/\D/g, '');
  if (!digits) return null;

  const { code, nsn } = countryOf(country);
  let full;
  if (str.startsWith('+') || international) full = digits;
  else if (digits.startsWith('00')) full = digits.slice(2);
  else if (digits.startsWith('0')) full = code + digits.replace(/^0+/, '');
  else if (nsn.includes(digits.length)) full = code + digits;
  else full = digits;

  return E164_DIGITS.test(full) ? `+${full}` : null;
}

/**
 * Spellings a contact with this number may have been stored under before
 * numbers were normalised on write. Lookups match all of them, so a contact
 * saved as "09876543210" is found instead of duplicated before the backfill
 * (scripts/backfill-contact-phones.js) has rewritten it.
 */
export function phoneVariants(e164, { country = DEFAULT_PHONE_COUNTRY } = {}) {
  if (!e164) return [];
  const digits = e164.replace(/\D/g, '');
  const out = new Set([e164, digits]);
  const { code } = countryOf(country);
  if (digits.startsWith(code)) {
    const national = digits.slice(code.length);
    out.add(national);
    out.add(`0${national}`);
  }
  return [...out];
}

/** The workspace's default country for numbers written without a country code. */
export async function workspacePhoneCountry(workspaceId, client = prisma) {
  try {
    const ws = await client.workspace.findUnique({ where: { id: workspaceId }, select: { defaultPhoneCountry: true } });
    return PHONE_COUNTRIES[ws?.defaultPhoneCountry] ? ws.defaultPhoneCountry : DEFAULT_PHONE_COUNTRY;
  } catch {
    // The country only matters for numbers typed without a code; a failed
    // read must not block the write that needs it.
    return DEFAULT_PHONE_COUNTRY;
  }
}

/** toE164 with the workspace's default country. */
export async function normalizeWorkspacePhone(workspaceId, raw, options = {}) {
  return toE164(raw, { ...options, country: await workspacePhoneCountry(workspaceId) });
}
