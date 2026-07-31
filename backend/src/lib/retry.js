function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const cleaned = timeStr.trim().toLowerCase();
  const ampmMatch = cleaned.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!ampmMatch) return null;
  let hours = parseInt(ampmMatch[1], 10);
  const minutes = parseInt(ampmMatch[2], 10);
  const ampm = ampmMatch[3];
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function normalizeRetryConfig(config) {
  if (!config || (config.enabled === false && config.active === false)) {
    return null;
  }
  const enabled = Boolean(config.enabled !== undefined ? config.enabled : config.active);
  if (!enabled) return null;

  const retryPattern = (config.retryPattern || config.pattern || 'smart').toLowerCase() === 'hourly' ? 'hourly' : 'smart';
  const retryEndDate = config.retryEndDate || config.endDate || null;

  let noRetryWindow = null;
  if (config.noRetryWindow && typeof config.noRetryWindow === 'object') {
    noRetryWindow = config.noRetryWindow;
  } else if (config.noRetryStart && config.noRetryEnd) {
    noRetryWindow = { start: config.noRetryStart, end: config.noRetryEnd };
  } else {
    noRetryWindow = { start: '09:00 PM', end: '06:00 AM' };
  }

  const smartRetrySchedule = retryPattern === 'smart' ? [
    { attempt: 1, delay: '1h', delayMs: 3600000 },
    { attempt: 2, delay: '2.5h', delayMs: 9000000 },
    { attempt: 3, delay: '4.8h', delayMs: 17280000 },
    { attempt: 4, delay: '8h', delayMs: 28800000 },
    { attempt: 5, delay: '14h', delayMs: 50400000 },
    { attempt: 6, delay: '24h', delayMs: 86400000 },
  ] : null;

  const hourlyRetrySchedule = retryPattern === 'hourly' ? Array.from({ length: 24 }, (_, i) => ({
    attempt: i + 1,
    delay: '1h',
    delayMs: 3600000,
  })) : null;

  return {
    enabled,
    active: enabled,
    retryEndDate,
    endDate: retryEndDate,
    retryPattern,
    pattern: retryPattern,
    noRetryWindow,
    noRetryStart: noRetryWindow?.start || '09:00 PM',
    noRetryEnd: noRetryWindow?.end || '06:00 AM',
    smartRetrySchedule,
    hourlyRetrySchedule,
  };
}

export function isRetryableFailure(reason = '', metaCode = null) {
  const text = String(reason || '').toLowerCase();
  let code = Number(metaCode);
  if (!code || isNaN(code)) {
    const match = text.match(/code\s*(\d+)/i);
    if (match) code = Number(match[1]);
  }

  // Known permanent Meta failure error codes
  const permanentCodes = new Set([
    131026, // Invalid phone number / undeliverable
    131031, // Account locked / spam
    131030, // Blocked recipient / phone number not in allowed list
    132000, 132001, 132005, 132007, 132012, 132015, 132016, // Template rejected/disabled/param count mismatch
    133010, // Opted out
    131009, 131000, // Permanent validation failure
  ]);
  if (code && permanentCodes.has(code)) return false;

  const permanentPatterns = [
    /invalid phone number/,
    /not a whatsapp user/,
    /blocked recipient/,
    /user blocked/,
    /opted out/,
    /template rejected/,
    /template.*disabled/,
    /template.*paused/,
    /permanent validation/,
    /quota and wallet balance exhausted/,
    /parameter count mismatch/,
  ];
  if (permanentPatterns.some((p) => p.test(text))) return false;

  // Known retryable Meta failure error codes
  // 131049: "This message was not delivered to maintain healthy ecosystem engagement."
  const retryableCodes = new Set([
    131049, 131048, 131056, // Frequency capping / throughput limit / ecosystem engagement
    130429, 429, // Rate limit
    500, 502, 503, 504, // Transient Meta server errors
    131052, 131053, // Transient media error
  ]);
  if (code && retryableCodes.has(code)) return true;

  const retryablePatterns = [
    /maintain healthy ecosystem engagement/,
    /frequency capping/,
    /rate limit/,
    /too many requests/,
    /network timeout/,
    /timeout/,
    /timed out/,
    /econnreset/,
    /enotfound/,
    /econnrefused/,
    /etimedout/,
    /temporary meta failure/,
    /transient/,
    /server error/,
    /service unavailable/,
  ];
  if (retryablePatterns.some((p) => p.test(text))) return true;

  return false;
}

export function calculateNextRetry(retryConfig, currentRetryCount = 0, fromDate = new Date()) {
  const config = normalizeRetryConfig(retryConfig);
  if (!config || !config.enabled) {
    return { shouldRetry: false, reason: 'Retries disabled or unconfigured' };
  }

  const attempt = Number(currentRetryCount || 0) + 1;
  const pattern = config.retryPattern;
  let delayMs = 0;
  let delayLabel = '';

  if (pattern === 'smart') {
    if (attempt > 6) {
      return { shouldRetry: false, status: 'MAX_RETRIES', reason: 'Maximum smart retries (6) reached' };
    }
    const schedule = config.smartRetrySchedule?.[attempt - 1];
    delayMs = schedule?.delayMs || 3600000;
    delayLabel = schedule?.delay || '1h';
  } else if (pattern === 'hourly') {
    if (attempt > 24) {
      return { shouldRetry: false, status: 'MAX_RETRIES', reason: 'Maximum hourly retries (24) reached' };
    }
    const schedule = config.hourlyRetrySchedule?.[attempt - 1];
    delayMs = schedule?.delayMs || 3600000;
    delayLabel = '1h';
  } else {
    return { shouldRetry: false, reason: 'Unknown retry pattern' };
  }

  let nextTime = new Date(fromDate.getTime() + delayMs);

  // Respect No-Retry Window
  if (config.noRetryWindow?.start && config.noRetryWindow?.end) {
    const startMin = parseTimeToMinutes(config.noRetryWindow.start);
    const endMin = parseTimeToMinutes(config.noRetryWindow.end);
    if (startMin !== null && endMin !== null && startMin !== endMin) {
      const currentMin = nextTime.getHours() * 60 + nextTime.getMinutes();
      let inWindow = false;
      if (startMin < endMin) {
        inWindow = currentMin >= startMin && currentMin < endMin;
        if (inWindow) {
          nextTime.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
        }
      } else {
        // Overnight window crossing midnight (e.g. 21:00 to 06:00)
        inWindow = currentMin >= startMin || currentMin < endMin;
        if (inWindow) {
          if (currentMin >= startMin) {
            nextTime.setDate(nextTime.getDate() + 1);
          }
          nextTime.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
        }
      }
    }
  }

  // Respect Retry End Date
  if (config.retryEndDate) {
    let endDate = new Date(config.retryEndDate);
    if (!isNaN(endDate.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(config.retryEndDate)) {
        endDate.setHours(23, 59, 59, 999);
      }
      if (nextTime.getTime() > endDate.getTime()) {
        return { shouldRetry: false, status: 'EXPIRED', reason: 'Retry time falls after configured retry end date' };
      }
    }
  }

  return {
    shouldRetry: true,
    attempt,
    delayMs: Math.max(0, nextTime.getTime() - Date.now()),
    nextTime,
    delayLabel,
    pattern,
  };
}
