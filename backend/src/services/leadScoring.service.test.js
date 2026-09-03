import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, MAX_SCORE } from './leadScoring.service.js';

function assertFactorsConsistent(result) {
  const sum = result.factors.reduce((s, f) => s + f.points, 0);
  assert.equal(result.score, Math.min(MAX_SCORE, sum), 'score must equal the sum of its factors');
  assert.ok(result.score >= 0 && result.score <= result.maxScore, 'score must be within [0, maxScore]');
  for (const f of result.factors) {
    assert.ok(f.points >= 0 && f.points <= f.maxPoints, `${f.key} points within [0, maxPoints]`);
    assert.ok(f.detail && f.detail.length > 0, `${f.key} must carry an explanation`);
  }
}

test('opted-out contact scores zero with a single explanatory factor', () => {
  const result = scoreLead({
    optedOut: true,
    daysSinceLastInboundMessage: 0,
    inboundMessageCount: 50,
    campaignsSentCount: 10,
    campaignsReadCount: 10,
    hasOpenConversation: true,
    hasEmail: true,
    hasTags: true,
    daysSinceContactCreated: 0,
  });
  assert.equal(result.score, 0);
  assert.equal(result.factors.length, 1);
  assert.equal(result.factors[0].key, 'optedOut');
});

test('contact with no engagement scores low but reports every factor', () => {
  const result = scoreLead({
    optedOut: false,
    daysSinceLastInboundMessage: null,
    inboundMessageCount: 0,
    campaignsSentCount: 0,
    campaignsReadCount: 0,
    hasOpenConversation: false,
    hasEmail: false,
    hasTags: false,
    daysSinceContactCreated: 400,
  });
  assert.equal(result.score, 0);
  assert.equal(result.factors.length, 6);
  assertFactorsConsistent(result);
});

test('fully engaged contact reaches the maximum score', () => {
  const result = scoreLead({
    optedOut: false,
    daysSinceLastInboundMessage: 0,
    inboundMessageCount: 12,
    campaignsSentCount: 4,
    campaignsReadCount: 4,
    hasOpenConversation: true,
    hasEmail: true,
    hasTags: true,
    daysSinceContactCreated: 1,
  });
  assert.equal(result.score, MAX_SCORE);
  assertFactorsConsistent(result);
});

test('reply recency decays across the defined bands', () => {
  const band = (days) => scoreLead({ daysSinceLastInboundMessage: days }).factors
    .find((f) => f.key === 'replyRecency').points;
  assert.equal(band(1), 30);
  assert.equal(band(7), 20);
  assert.equal(band(30), 10);
  assert.equal(band(31), 0);
  assert.equal(scoreLead({ daysSinceLastInboundMessage: null }).factors
    .find((f) => f.key === 'replyRecency').points, 0);
});

test('campaign engagement is proportional to read ratio and zero without sends', () => {
  const pts = (sent, read) => scoreLead({ campaignsSentCount: sent, campaignsReadCount: read }).factors
    .find((f) => f.key === 'campaignEngagement').points;
  assert.equal(pts(0, 0), 0);
  assert.equal(pts(4, 4), 20);
  assert.equal(pts(4, 2), 10);
  assert.equal(pts(4, 0), 0);
});

test('partial signals still produce a consistent, explainable score', () => {
  const result = scoreLead({
    daysSinceLastInboundMessage: 5,
    inboundMessageCount: 3,
    campaignsSentCount: 2,
    campaignsReadCount: 1,
    hasOpenConversation: false,
    hasEmail: true,
    hasTags: false,
    daysSinceContactCreated: 10,
  });
  assert.equal(result.score, 20 + 15 + 10 + 0 + 5 + 3);
  assertFactorsConsistent(result);
});

// Defaults treat a missing contact age as "created today", so the freshness
// factor is the only one that can score without any supplied signal.
test('empty signal object does not throw and scores freshness only', () => {
  const result = scoreLead({});
  assert.equal(result.score, 10);
  assert.equal(result.factors.find((f) => f.key === 'freshness').points, 10);
  assertFactorsConsistent(result);
});

test('undefined signals are tolerated', () => {
  assertFactorsConsistent(scoreLead(undefined));
});
