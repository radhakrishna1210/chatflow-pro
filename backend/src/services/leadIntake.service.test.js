import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareLeadIntake, resolveLeadStatus, resolveLeadSource, resolveLeadTags, leadStatusWrite,
} from './leadIntake.service.js';

// CF-154: the shared rules every lead intake path applies. Strict paths (CRM
// screens) are covered over HTTP in routes/leads.intake.http.test.js; these
// are the lenient paths nobody is present to correct (forms, import, campaign
// replies, automations).

const rules = {
  lifecycle: { stages: [{ key: 'NEW', label: 'New', isDefault: true }, { key: 'CONTACTED', label: 'Contacted' }, { key: 'DEMO_BOOKED', label: 'Demo Booked' }] },
  sources: { sources: [
    { key: 'WEBSITE', name: 'Website Form', isActive: true, utmSource: 'web' },
    { key: 'EVENT', name: 'Event', isActive: false },
    { key: 'OTHER', name: 'Other', isActive: true },
  ] },
  tags: { tags: [{ name: 'High Value' }, { name: 'Enterprise' }] },
  criteria: { requireEmail: true },
};

test('lenient status: labels resolve to keys, unknown ones fall back to the default stage', () => {
  assert.deepEqual(resolveLeadStatus(rules, 'demo booked', { strict: false }),
    { key: 'DEMO_BOOKED', status: 'NEW', statusKey: 'DEMO_BOOKED', adjusted: null });
  const unknown = resolveLeadStatus(rules, 'Qualified', { strict: false });
  assert.equal(unknown.key, 'NEW');
  assert.match(unknown.adjusted, /not in the lead lifecycle/);
  // LOST and CONVERTED are system states a lifecycle edit cannot remove.
  assert.equal(resolveLeadStatus(rules, 'lost').key, 'LOST');
});

test('a status write clears a stale custom key when a built-in stage is set', () => {
  const { data } = leadStatusWrite(rules, 'CONTACTED', { statusKey: 'DEMO_BOOKED', region: 'EU' });
  assert.deepEqual(data, { status: 'CONTACTED', customFields: { region: 'EU' } });
  assert.throws(() => leadStatusWrite(rules, 'NURTURING', null), (e) => e.status === 400);
});

test('lenient source: unknown or disabled sources fall back and keep the original as detail', () => {
  assert.deepEqual(resolveLeadSource(rules, 'web', { strict: false }), { source: 'WEBSITE', detail: null, adjusted: null });
  const campaign = resolveLeadSource(rules, 'Campaign: Diwali', { strict: false, fallbacks: ['CAMPAIGN'] });
  assert.equal(campaign.source, 'OTHER');
  assert.equal(campaign.detail, 'Campaign: Diwali');
  assert.equal(resolveLeadSource(rules, 'Event', { strict: false }).source, 'OTHER');
  // Nothing given and no channel default: no source is invented.
  assert.equal(resolveLeadSource(rules, '', { strict: false }).source, null);
});

test('lenient tags: unconfigured new tags are dropped, existing contact tags kept', () => {
  assert.deepEqual(
    resolveLeadTags(rules, ['enterprise', 'Whale', 'newsletter'], { strict: false, existing: ['newsletter'] }),
    { tags: ['Enterprise', 'newsletter'], rejected: ['Whale'] },
  );
});

test('an import row is adjusted, never rejected, and every adjustment is reported', () => {
  const intake = prepareLeadIntake(rules, {
    status: 'Hot', source: 'Billboard', tags: ['High Value', 'Whale'], phone: '+919876543210', email: null,
  }, { strict: false });
  assert.equal(intake.status, 'NEW');
  assert.equal(intake.source, 'OTHER');
  assert.deepEqual(intake.tags, ['High Value']);
  assert.equal(intake.customFields.qualification.isQualified, false);
  assert.deepEqual(intake.customFields.qualification.missingRequired, ['email']);
  assert.equal(intake.warnings.length, 4);
});

test('strict intake refuses what lenient intake adjusts', () => {
  assert.throws(() => prepareLeadIntake(rules, { phone: '+91', email: null }), /Email is required/);
  assert.throws(() => prepareLeadIntake(rules, { email: 'a@b.test', source: 'Billboard' }), /Invalid lead source/);
});
