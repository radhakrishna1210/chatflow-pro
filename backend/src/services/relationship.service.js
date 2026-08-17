// Relationship strength for one contact.
//
// §53 asks for this and then, unusually, warns against overclaiming: "do not
// pretend relationship health is scientifically precise." So this reports a
// band with its reasons rather than a number pretending to be a measurement,
// and every band names the observable facts behind it.
//
// Pure: plain signals in, a banded verdict out. No I/O, so the judgement can be
// tested without a database.

const DAY = 86400000;

export const BANDS = ['STRONG', 'MODERATE', 'WEAK', 'AT_RISK'];

export function relationshipStrength(signals) {
  const {
    daysSinceLastInbound = null,
    daysSinceLastOutbound = null,
    inboundCount = 0,
    outboundCount = 0,
    daysKnown = 0,
    optedOut = false,
  } = signals ?? {};

  const factors = [];
  const add = (label, detail, tone) => factors.push({ label, detail, tone });

  if (optedOut) {
    return {
      band: 'AT_RISK',
      factors: [{ label: 'Opted out', detail: 'This contact has asked not to be messaged.', tone: 'bad' }],
      // Stated so callers do not present a band as a measurement.
      confidence: 'certain',
    };
  }

  // Never heard from them at all.
  if (inboundCount === 0) {
    add('No reply yet', outboundCount > 0
      ? `${outboundCount} message(s) sent, none answered.`
      : 'Nothing has been exchanged yet.', 'bad');
    return {
      band: outboundCount >= 3 ? 'AT_RISK' : 'WEAK',
      factors,
      confidence: outboundCount === 0 ? 'low' : 'moderate',
    };
  }

  let score = 0;

  // Recency of their last reply carries the most weight: a conversation that
  // stopped is the clearest signal a relationship is cooling.
  if (daysSinceLastInbound != null) {
    if (daysSinceLastInbound <= 7) { score += 3; add('Replied recently', `Last reply ${daysSinceLastInbound} day(s) ago.`, 'good'); }
    else if (daysSinceLastInbound <= 30) { score += 1; add('Replied this month', `Last reply ${daysSinceLastInbound} days ago.`, 'ok'); }
    else if (daysSinceLastInbound <= 90) { score -= 1; add('Going quiet', `No reply for ${daysSinceLastInbound} days.`, 'bad'); }
    else { score -= 2; add('Long silence', `No reply for ${daysSinceLastInbound} days.`, 'bad'); }
  }

  // Depth of exchange.
  if (inboundCount >= 10) { score += 2; add('Sustained conversation', `${inboundCount} replies received.`, 'good'); }
  else if (inboundCount >= 3) { score += 1; add('Two-way conversation', `${inboundCount} replies received.`, 'good'); }
  else { add('Limited exchange', `${inboundCount} reply so far.`, 'ok'); }

  // Reciprocity. A thread where we send ten and they send one is a broadcast,
  // not a relationship — worth naming rather than scoring silently.
  if (outboundCount >= 5 && inboundCount / Math.max(outboundCount, 1) < 0.25) {
    score -= 1;
    add('Mostly one-sided', `${outboundCount} sent against ${inboundCount} received.`, 'bad');
  }

  // A long-standing contact who still replies is stronger than a new one who
  // has replied once.
  if (daysKnown >= 90 && (daysSinceLastInbound ?? 999) <= 30) {
    score += 1;
    add('Long-standing', `Known for ${Math.floor(daysKnown / 30)} month(s) and still engaged.`, 'good');
  }

  const band = score >= 4 ? 'STRONG' : score >= 2 ? 'MODERATE' : score >= 0 ? 'WEAK' : 'AT_RISK';

  return {
    band,
    factors,
    // Two data points is not a trend. Saying so is more useful than a
    // confident-looking band built on almost nothing.
    confidence: inboundCount + outboundCount >= 6 ? 'moderate' : 'low',
  };
}

// Builds signals for one contact from already-loaded message rows, so a caller
// scoring many contacts does not issue a query per contact.
export function buildSignals({ contact, messages = [], now = new Date() }) {
  const inbound = messages.filter((m) => m.direction === 'INBOUND');
  const outbound = messages.filter((m) => m.direction === 'OUTBOUND');
  const latest = (rows) => (rows.length ? rows.reduce((a, b) => (a.sentAt > b.sentAt ? a : b)).sentAt : null);

  const lastIn = latest(inbound);
  const lastOut = latest(outbound);

  return {
    optedOut: !!contact?.optedOut,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    daysSinceLastInbound: lastIn ? Math.floor((now - lastIn) / DAY) : null,
    daysSinceLastOutbound: lastOut ? Math.floor((now - lastOut) / DAY) : null,
    daysKnown: contact?.createdAt ? Math.floor((now - contact.createdAt) / DAY) : 0,
  };
}
