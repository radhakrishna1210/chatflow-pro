// Working hours for the Out-of-Office automation. The UI has always described
// OOO as "set up your working hours", but no such concept existed — OOO only
// fired on reopened conversations. This is that concept.
//
// Shape stored on Workspace.businessHours:
//   { tz: "Asia/Kolkata", days: [{ day: 0, enabled: true, start: "09:00", end: "18:00" }, ...] }
// day is 0=Sunday … 6=Saturday, matching Date#getDay.

export const DEFAULT_BUSINESS_HOURS = {
  tz: 'Asia/Kolkata',
  days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    enabled: day >= 1 && day <= 5,
    start: '09:00',
    end: '18:00',
  })),
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (hhmm) => {
  const m = HHMM.exec(String(hhmm || ''));
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

// Validates and fills in a config from the client. Returns null for "always
// open" so a workspace can switch working hours off entirely.
export function normalizeBusinessHours(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') {
    const e = new Error('businessHours must be an object or null');
    e.status = 400;
    throw e;
  }

  const tz = String(raw.tz || DEFAULT_BUSINESS_HOURS.tz).trim();
  // Reject an unknown zone here rather than letting every later OOO check
  // throw inside the webhook handler.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    const e = new Error(`Unknown timezone "${tz}"`);
    e.status = 400;
    throw e;
  }

  const byDay = new Map();
  for (const entry of Array.isArray(raw.days) ? raw.days : []) {
    const day = Number(entry?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const start = toMinutes(entry.start);
    const end = toMinutes(entry.end);
    if (entry.enabled && (start === null || end === null)) {
      const e = new Error(`Working hours for day ${day} must be HH:MM`);
      e.status = 400;
      throw e;
    }
    if (entry.enabled && end <= start) {
      const e = new Error(`Closing time must be after opening time for day ${day}`);
      e.status = 400;
      throw e;
    }
    byDay.set(day, {
      day,
      enabled: !!entry.enabled,
      start: start === null ? '09:00' : entry.start,
      end: end === null ? '18:00' : entry.end,
    });
  }

  return {
    tz,
    days: DEFAULT_BUSINESS_HOURS.days.map((d) => byDay.get(d.day) || { ...d, enabled: false }),
  };
}

// Day-of-week + minutes-since-midnight in the workspace's timezone. Uses
// Intl rather than a date library because the project has no tz dependency and
// the server may run in any zone (Render uses UTC).
function localParts(tz, at) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  // Intl renders midnight as "24" in some ICU versions with hour12:false.
  const hour = parseInt(parts.hour, 10) % 24;
  return { day: dayIndex, minutes: hour * 60 + parseInt(parts.minute, 10) };
}

// No config means "always open" — callers then fall back to the old
// reopened-conversation behaviour instead of sending OOO around the clock.
export function isWithinBusinessHours(businessHours, at = new Date()) {
  if (!businessHours || !Array.isArray(businessHours.days)) return true;

  const tz = businessHours.tz || DEFAULT_BUSINESS_HOURS.tz;
  let now;
  try {
    now = localParts(tz, at);
  } catch (err) {
    console.error(`[BusinessHours] Bad timezone "${tz}", treating as always open:`, err.message);
    return true;
  }

  const today = businessHours.days.find((d) => Number(d.day) === now.day);
  if (!today || !today.enabled) return false;

  const start = toMinutes(today.start);
  const end = toMinutes(today.end);
  if (start === null || end === null) return true;

  return now.minutes >= start && now.minutes < end;
}
