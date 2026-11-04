import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailHtml } from './email.service.js';
import { env } from '../config/env.js';

const XSS = '<img src=x onerror=alert(1)>';

test('every user-controlled value in email templates is HTML-escaped', () => {
  const cases = [
    ['campaign-completed', { recipientName: XSS, campaignName: XSS, sent: 1, delivered: 1, read: 1, failed: 0, totalContacts: 1 }],
    ['campaign-failed', { recipientName: XSS, campaignName: XSS }],
    ['template-approved', { recipientName: XSS, templateName: XSS }],
    ['template-rejected', { recipientName: XSS, templateName: XSS }],
    ['member-invited', { inviteeName: XSS, inviterName: XSS, workspaceName: XSS }],
    ['workspace-invite', { inviterName: XSS, workspaceName: XSS, token: 'abc' }],
    ['api-key-created', { userName: XSS, keyName: XSS, environment: XSS, keyPrefix: XSS }],
    ['welcome', { name: XSS }],
    ['signup-otp', { name: XSS, code: '123456' }],
  ];
  for (const [type, payload] of cases) {
    const { html } = buildEmailHtml(type, payload);
    assert.ok(!html.includes('<img src=x'), `${type} leaks raw HTML`);
    assert.ok(html.includes('&lt;img src=x'), `${type} should contain the escaped value`);
  }
});

test('campaign summary tolerates missing counters instead of throwing', () => {
  const { html } = buildEmailHtml('campaign-completed', { recipientName: 'A', campaignName: 'C' });
  assert.match(html, /Messages Sent/);
});

test('unknown and prototype email types are rejected', () => {
  for (const type of ['nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.throws(() => buildEmailHtml(type, {}), /Unknown email type/);
  }
});

test('dashboard links point at the frontend (CLIENT_URL), not the API base', () => {
  const { html } = buildEmailHtml('welcome', { name: 'A' });
  assert.ok(html.includes(`href="${env.CLIENT_URL}"`));
  const exists = buildEmailHtml('signup-exists', { name: 'A' }).html;
  assert.ok(exists.includes(`href="${env.CLIENT_URL}/login"`));
});
