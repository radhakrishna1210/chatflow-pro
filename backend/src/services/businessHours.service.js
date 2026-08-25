// Working hours for the Out-of-Office automation. The UI has always described
// OOO as "set up your working hours", but no such concept existed — OOO only
// fired on reopened conversations. This is that concept.
//
// Shape stored on Workspace.businessHours:
//   { tz: "Asia/Kolkata", enabled: true, days: [{ day: 0, enabled: true, start: "09:00", end: "18:00" }, ...] }
// day is 0=Sunday … 6=Saturday, matching Date#getDay.
//
// `enabled` is the feature switch and is deliberately stored *inside* the same
// blob as the schedule so that switching working hours off no longer erases the
// configured days (QA BUG-01). A legacy row that has no `enabled` key was saved
// back when non-null meant "on", so it reads back as enabled.

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

  const featureEnabled = raw.enabled === undefined ? true : !!raw.enabled;
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
    enabled: featureEnabled,
    days: DEFAULT_BUSINESS_HOURS.days.map((d) => byDay.get(d.day) || { ...d, enabled: false }),
  };
}

// Reads the feature switch off a stored blob. Legacy rows: null === off,
// a blob without an `enabled` key === on.
export function isBusinessHoursEnabled(stored) {
  if (!stored || typeof stored !== 'object') return false;
  return stored.enabled === undefined ? true : !!stored.enabled;
}

// Merges a schedule edit and/or a feature-switch edit onto what is already
// stored, so neither operation can clobber the other.
export function mergeBusinessHours(stored, { schedule, enabled } = {}) {
  const base = stored && typeof stored === 'object' && Array.isArray(stored.days)
    ? { ...stored, enabled: isBusinessHoursEnabled(stored) }
    : { ...DEFAULT_BUSINESS_HOURS, enabled: false };

  let next = base;
  if (schedule !== undefined) {
    // A null schedule now only resets the days to the defaults; it no longer
    // doubles as "turn the feature off".
    next = schedule === null
      ? { ...DEFAULT_BUSINESS_HOURS, enabled: base.enabled }
      : { ...normalizeBusinessHours({ ...schedule, enabled: base.enabled }) };
  }
  if (enabled !== undefined) next = { ...next, enabled: !!enabled };
  return next;
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
  // Feature switched off → always open, schedule stays on disk untouched.
  if (!isBusinessHoursEnabled(businessHours)) return true;

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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A human-readable summary of the schedule, for answering "what are your
// working hours?" from the configuration the workspace already filled in
// instead of sending the question to the model (QA BUG-03).
// Returns null when there is nothing meaningful to say.
export function describeBusinessHours(businessHours) {
  if (!businessHours || !Array.isArray(businessHours.days)) return null;
  if (!isBusinessHoursEnabled(businessHours)) return null;

  const open = businessHours.days.filter((d) => d.enabled && d.start && d.end);
  if (open.length === 0) return null;

  // Collapse consecutive days that share the same window: "Monday-Friday,
  // 09:00-18:00" rather than five identical lines.
  const ordered = [...open].sort((a, b) => Number(a.day) - Number(b.day));
  const groups = [];
  for (const day of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.start === day.start && last.end === day.end && Number(day.day) === last.to + 1) {
      last.to = Number(day.day);
    } else {
      groups.push({ from: Number(day.day), to: Number(day.day), start: day.start, end: day.end });
    }
  }

  const lines = groups.map((g) => {
    const label = g.from === g.to ? DAY_NAMES[g.from] : `${DAY_NAMES[g.from]}–${DAY_NAMES[g.to]}`;
    return `${label}: ${g.start}–${g.end}`;
  });
  return `Our working hours are:\n${lines.join('\n')}\n(${businessHours.tz || DEFAULT_BUSINESS_HOURS.tz})`;
}
