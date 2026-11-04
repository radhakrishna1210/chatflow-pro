// Turning a stored phone number into the bare-digit international form Meta
// addresses recipients by.
//
// Contacts are often imported in national format ("9876543210",
// "09876543210") — that is how people write their own numbers. Meta has no
// way to know which country such a number is in, so the send failed. The
// inbound side already matches these contacts (webhook.service, national
// 10-digit tail match); this is the outbound half.
//
// There is no per-workspace country setting, so the country is taken from the
// business number the message is sent *from* — a workspace sending from a +91
// number is writing to Indian customers — and falls back to India (+91), the
// product default, when the sender is not known.

export const DEFAULT_CALLING_CODE = '91';

// ITU-T E.164 country calling codes of two digits. Zones 1 (NANP) and 7 are
// one digit; everything not listed here is three.
const TWO_DIGIT_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44',
  '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58',
  '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91',
  '92', '93', '94', '95', '98',
]);

// The calling code at the front of an international number, e.g.
// "+91 98765 43210" -> "91", "+1 212 555 1234" -> "1". Null when the value is
// too short to be international.
export function callingCodeOf(international) {
  const digits = String(international ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 8) return null;
  if (digits[0] === '1' || digits[0] === '7') return digits[0];
  const two = digits.slice(0, 2);
  return TWO_DIGIT_CODES.has(two) ? two : digits.slice(0, 3);
}

// Bare digits in international format. A value written with "+" or "00" is
// already international and only loses its punctuation. A national number —
// as long as the sender's national numbers (10 digits for +91/+1), optionally
// behind a single trunk "0" — gets the sender's calling code in front.
// Anything else is passed through as digits, unchanged.
export function toE164Digits(raw, senderPhone = null) {
  const str = String(raw ?? '').trim();
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';
  if (str.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);

  const senderDigits = String(senderPhone ?? '').replace(/\D/g, '');
  const senderCode = callingCodeOf(senderPhone);
  const code = senderCode || DEFAULT_CALLING_CODE;
  const nationalLength = senderCode ? senderDigits.length - senderCode.length : 10;
  if (nationalLength < 6) return digits;

  const national = digits.length === nationalLength + 1 && digits.startsWith('0')
    ? digits.slice(1)
    : digits;
  if (national.length === nationalLength && !national.startsWith('0')) return `${code}${national}`;
  return digits;
}
