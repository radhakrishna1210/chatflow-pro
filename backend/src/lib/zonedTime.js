// Calendar days in a named time zone, for bucketing analytics by the
// workspace's own day rather than the server's (or a hard-coded India).

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const formatters = new Map();
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(tz);
}

function zonedParts(date, tz) {
  const parts = {};
  for (const { type, value } of formatterFor(tz).formatToParts(date)) parts[type] = Number(value);
  return parts;
}

// 'YYYY-MM-DD' of the calendar day `date` falls on in `tz`.
export function zonedDayKey(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// How far `tz` is ahead of UTC at `date`, in ms.
function offsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant local midnight starts the day `dayKey` in `tz`. Re-checked once
// so a DST change between UTC midnight and local midnight lands correctly.
export function zonedMidnight(dayKey, tz) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(instant), tz);
  if (second !== instant) instant = second;
  return new Date(instant);
}

function shiftKey(dayKey, deltaDays) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

// Weekday (0 = Sunday) of a day key; independent of any zone.
export function weekdayOfKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The last `days` whole calendar days in `tz`, today included: their keys,
// oldest first, and the instant the first one starts.
export function zonedDayWindow(days, tz, now = new Date()) {
  const today = zonedDayKey(now, tz);
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) keys.push(shiftKey(today, -i));
  return { keys, since: zonedMidnight(keys[0], tz), today };
}
