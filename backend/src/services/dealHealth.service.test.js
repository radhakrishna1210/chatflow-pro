import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreDealHealth, buildSignals, MAX_HEALTH } from './dealHealth.service.js';

const sumFactors = (r) => r.factors.reduce((s, f) => s + f.points, 0);
const riskKeys = (r) => r.risks.map((x) => x.key);

// A deal doing everything right: recently worked, young in stage, credible
// close date, fully filled in, with a next step agreed.
const healthy = {
  stage: 'PROPOSAL',
  daysInCurrentStage: 3,
  daysSinceLastActivity: 1,
  daysUntilExpectedClose: 10,
  hasValue: true,
  hasOwner: true,
  hasExpectedCloseDate: true,
  openTaskCount: 2,
};

test('a well-tended deal scores full health with no risks', () => {
  const r = scoreDealHealth(healthy);
  assert.equal(r.score, MAX_HEALTH);
  assert.equal(r.band, 'HEALTHY');
  assert.equal(sumFactors(r), r.score);
  assert.deepEqual(r.risks, []);
});

test('a closed deal reports an outcome instead of a score', () => {
  for (const stage of ['CLOSED_WON', 'CLOSED_LOST']) {
    const r = scoreDealHealth({ ...healthy, stage });
    assert.equal(r.score, null, `${stage} must not carry a health score`);
    assert.equal(r.band, 'CLOSED');
    assert.deepEqual(r.risks, []);
  }
});

test('stage age degrades in two steps and flags the deal', () => {
  // PROPOSAL budget is 14 days.
  const ok = scoreDealHealth({ ...healthy, daysInCurrentStage: 14 });
  assert.equal(ok.factors.find((f) => f.key === 'stageAge').points, 30);
  assert.ok(!riskKeys(ok).includes('ageing'));

  const ageing = scoreDealHealth({ ...healthy, daysInCurrentStage: 20 });
  assert.equal(ageing.factors.find((f) => f.key === 'stageAge').points, 15);
  assert.ok(riskKeys(ageing).includes('ageing'));

  const stalled = scoreDealHealth({ ...healthy, daysInCurrentStage: 40 });
  assert.equal(stalled.factors.find((f) => f.key === 'stageAge').points, 0);
  assert.ok(riskKeys(stalled).includes('stalled'));
});

test('later stages are held to a tighter age budget than early ones', () => {
  const signals = { ...healthy, daysInCurrentStage: 15 };
  const qualification = scoreDealHealth({ ...signals, stage: 'QUALIFICATION' });
  const negotiation = scoreDealHealth({ ...signals, stage: 'NEGOTIATION' });

  // 15 days is within Qualification's 21-day norm but past Negotiation's 10.
  assert.equal(qualification.factors.find((f) => f.key === 'stageAge').points, 30);
  assert.ok(negotiation.factors.find((f) => f.key === 'stageAge').points < 30);
});

test('silence is reported as a risk, and never-touched is the worst case', () => {
  const quiet = scoreDealHealth({ ...healthy, daysSinceLastActivity: 10 });
  assert.ok(riskKeys(quiet).includes('quiet'));

  const silent = scoreDealHealth({ ...healthy, daysSinceLastActivity: 30 });
  assert.equal(silent.factors.find((f) => f.key === 'activity').points, 0);
  assert.ok(riskKeys(silent).includes('noActivity'));

  const never = scoreDealHealth({ ...healthy, daysSinceLastActivity: null });
  assert.equal(never.factors.find((f) => f.key === 'activity').points, 0);
  assert.ok(riskKeys(never).includes('noActivity'));
});

test('a close date in the past is critical, not merely late', () => {
  const slipped = scoreDealHealth({ ...healthy, daysUntilExpectedClose: -6 });
  const factor = slipped.factors.find((f) => f.key === 'closeDate');
  assert.equal(factor.points, 0);
  assert.equal(factor.severity, 'critical');
  assert.match(factor.detail, /passed 6 days ago/);
  assert.ok(riskKeys(slipped).includes('closeDateExpired'));

  // One day late reads as "1 day", not "1 days".
  const oneDay = scoreDealHealth({ ...healthy, daysUntilExpectedClose: -1 });
  const msg = oneDay.risks.find((r) => r.key === 'closeDateExpired').message;
  assert.match(msg, /slipped 1 day ago/);
  assert.doesNotMatch(msg, /1 days/);
});

test('missing amount, owner, close date and next step each raise their own risk', () => {
  const bare = scoreDealHealth({
    ...healthy,
    hasValue: false,
    hasOwner: false,
    hasExpectedCloseDate: false,
    daysUntilExpectedClose: null,
    openTaskCount: 0,
  });
  const keys = riskKeys(bare);
  for (const expected of ['noValue', 'noOwner', 'noCloseDate', 'noNextStep']) {
    assert.ok(keys.includes(expected), `expected a ${expected} risk`);
  }
  assert.equal(bare.factors.find((f) => f.key === 'completeness').points, 0);
});

test('a critical risk stops a deal being called healthy, however well it scores', () => {
  // Strong on every scored factor except activity: nobody has touched it in a
  // month. 30 + 0 + 20 + 20 = 70, which would otherwise read HEALTHY.
  const neglected = scoreDealHealth({ ...healthy, daysSinceLastActivity: 30 });

  assert.equal(neglected.score, 70);
  assert.equal(neglected.band, 'AT_RISK', 'an untouched deal must not read as healthy');
  assert.ok(riskKeys(neglected).includes('noActivity'));
});

test('a warning-only risk does not demote a healthy deal', () => {
  // No open task is a warning, not a disqualifier.
  const r = scoreDealHealth({ ...healthy, openTaskCount: 0 });
  assert.equal(r.band, 'HEALTHY');
  assert.ok(riskKeys(r).includes('noNextStep'));
});

test('bands follow the score, and the worst deal lands in CRITICAL', () => {
  const worst = scoreDealHealth({
    stage: 'NEGOTIATION',
    daysInCurrentStage: 90,
    daysSinceLastActivity: 60,
    daysUntilExpectedClose: -30,
    hasValue: false,
    hasOwner: false,
    hasExpectedCloseDate: true,
    openTaskCount: 0,
  });
  assert.equal(worst.score, 0);
  assert.equal(worst.band, 'CRITICAL');
  // Most severe first, so the UI can show the top risk without re-sorting.
  assert.equal(worst.risks[0].severity, 'critical');
});

test('every factor stays within its own maximum and sums to the score', () => {
  const cases = [
    healthy,
    { ...healthy, daysInCurrentStage: 40, daysSinceLastActivity: 40 },
    { ...healthy, hasValue: false, hasOwner: false },
    {},
  ];
  for (const c of cases) {
    const r = scoreDealHealth(c);
    if (r.score === null) continue;
    assert.equal(sumFactors(r), r.score);
    assert.ok(r.score >= 0 && r.score <= MAX_HEALTH);
    for (const f of r.factors) {
      assert.ok(f.points <= f.maxPoints, `${f.key} exceeded its maximum`);
      assert.ok(f.points >= 0, `${f.key} went negative`);
    }
  }
});

test('an empty signal object does not throw', () => {
  const r = scoreDealHealth({});
  assert.equal(typeof r.score, 'number');
  assert.ok(Array.isArray(r.risks));
  assert.equal(scoreDealHealth(undefined).score, r.score);
});

test('buildSignals measures stage age from the last stage move, not creation', () => {
  const now = new Date('2026-08-16T12:00:00Z');
  const deal = {
    stage: 'PROPOSAL',
    value: 500,
    ownerUserId: 'u1',
    expectedCloseDate: new Date('2026-08-26T12:00:00Z'),
    createdAt: new Date('2026-06-01T12:00:00Z'),
    stageHistory: [
      { changedAt: new Date('2026-06-01T12:00:00Z') },
      { changedAt: new Date('2026-08-11T12:00:00Z') },
    ],
  };

  const signals = buildSignals(deal, { lastActivityAt: new Date('2026-08-15T12:00:00Z'), openTaskCount: 1, now });

  // The deal is 76 days old but only 5 days into its current stage.
  assert.equal(signals.daysInCurrentStage, 5);
  assert.equal(signals.daysSinceLastActivity, 1);
  assert.equal(signals.daysUntilExpectedClose, 10);
  assert.equal(signals.hasValue, true);
  assert.equal(signals.hasOwner, true);
});

test('buildSignals falls back to creation date when there is no stage history', () => {
  const now = new Date('2026-08-16T12:00:00Z');
  const signals = buildSignals(
    { stage: 'QUALIFICATION', createdAt: new Date('2026-08-06T12:00:00Z'), stageHistory: [], value: null, ownerUserId: null, expectedCloseDate: null },
    { lastActivityAt: null, now },
  );
  assert.equal(signals.daysInCurrentStage, 10);
  assert.equal(signals.daysSinceLastActivity, null);
  assert.equal(signals.daysUntilExpectedClose, null);
  assert.equal(signals.hasExpectedCloseDate, false);
});
