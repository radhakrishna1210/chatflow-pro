#!/usr/bin/env node
/**
 * Coverage test for the website assistant's retrieval layer.
 *
 *   node --env-file=.env scripts/test-assistant-coverage.mjs
 *
 * Asserts two properties that together define "answers about the product, and
 * only about the product":
 *
 *   1. Every in-scope question clears the relevance guard AND puts a document
 *      that can actually answer it inside the context window the assistant
 *      sends to the model.
 *   2. Every off-topic question is refused before any model is called.
 *
 * Retrieval-level on purpose: it costs one query embedding per case and no
 * generation quota, so the whole suite is runnable on a free-tier key. It is
 * also the layer where the interesting failures live — a wrong answer from
 * this assistant is nearly always the wrong passage retrieved, not the model
 * mishandling a right one.
 *
 * Run it after editing anything under src/data/, which is what the index is
 * built from. Exits non-zero on any failure.
 */

// Coverage sweep for the website assistant.
//
// Retrieval-level, so it costs one query embedding per case and no generation
// quota. For each question it checks two things:
//   1. the relevance guard lets it through (or refuses it, for the off-topic set)
//   2. the top-ranked chunk belongs to a document that should answer it
//
// A question can legitimately be answered by more than one document, so the
// expectation is a set of acceptable docIds rather than a single one.

import { retrieve } from '../src/services/siteRetrieval.service.js';

// Mirrors isRelevant() in siteAssistant.service.js.
const COVERAGE_FLOOR = 0.34;
const SEMANTIC_FLOOR = 0.62;
const WEAK_SEMANTIC_FLOOR = 0.59;
const passes = (r) => (
  !r.semantic
    ? r.coverage >= COVERAGE_FLOOR
    : r.bestSemantic >= SEMANTIC_FLOOR
      || (r.coverage >= COVERAGE_FLOOR && r.bestSemantic >= WEAK_SEMANTIC_FLOOR)
);

// The assistant sends the top MAX_CONTEXT_CHUNKS to the model, so a document
// anywhere in that window reaches it. Checking a narrower window than
// production uses would fail cases that actually answer correctly.
const CONTEXT_WINDOW = 5;

// [question, [acceptable docIds]]
const CASES = {
  'Campaigns': [
    ['how do I create a campaign?', ['help-create-campaign']],
    ['how to launch a campaign', ['help-create-campaign', 'help-campaign-statuses']],
    ['can I schedule a campaign for later?', ['help-create-campaign', 'help-campaign-statuses']],
    ['how do I choose who receives a campaign?', ['help-create-campaign', 'help-contacts-segments-clusters']],
    ['what does skipped mean on a campaign?', ['help-campaign-statuses', 'help-opt-outs', 'help-campaign-billing']],
    ['how do retries work?', ['help-campaign-retries', 'help-create-campaign']],
    ['can I use SMS fallback and retries together?', ['help-campaign-retries']],
    ['how do I save a campaign as a draft?', ['help-create-campaign', 'help-campaign-statuses']],
    ['how do I attach an AI agent to a campaign?', ['help-create-campaign', 'help-automation-ai-agent']],
  ],
  'Templates': [
    ['how do I create a template?', ['help-templates-create']],
    ['what template categories are there?', ['help-templates-create', 'help-message-pricing']],
    ['how do template variables work?', ['help-templates-create', 'help-create-campaign']],
    ['why was my template rejected?', ['help-templates-approval']],
    ['how long does template approval take?', ['help-templates-approval']],
    ['can AI write my template copy?', ['help-templates-create', 'site-feature-template-studio']],
  ],
  'Contacts': [
    ['how do I add a contact?', ['help-contacts-add']],
    ['how do I import contacts from CSV?', ['help-contacts-add']],
    ['what is a segment?', ['help-contacts-segments-clusters']],
    ['how do I create a cluster?', ['help-contacts-segments-clusters']],
    ['what format should phone numbers be in?', ['help-contacts-add']],
  ],
  'Number setup': [
    ['how do I connect a WhatsApp number?', ['help-number-setup']],
    ['can I use my own WhatsApp Business API number?', ['help-number-setup', 'site-faq-do-i-need-my-own-whatsapp-business-api-access']],
    ['how do I get a number from the pool?', ['help-number-setup']],
    ['what is a quality rating?', ['help-number-setup']],
  ],
  'Inbox': [
    ['how do I reply to a customer?', ['help-inbox']],
    ['can I assign a conversation to a teammate?', ['help-inbox']],
    ['what are internal notes?', ['help-inbox']],
    ['why cant I send a free form message?', ['help-inbox']],
  ],
  'Automation': [
    ['how do I set up a keyword auto reply?', ['help-automation-keyword-triggers']],
    ['how do I set a welcome message?', ['help-automation-basic']],
    ['how do I configure business hours?', ['help-automation-basic']],
    ['what is AI intent matching?', ['help-automation-intent-matching']],
    ['how do I deploy the AI agent?', ['help-automation-ai-agent']],
    ['how do I build a workflow?', ['help-automation-workflows']],
    ['how do I make a chat form?', ['help-automation-forms', 'site-feature-forms-over-chat']],
    ['does it answer phone calls?', ['help-automation-voice-instagram', 'site-feature-voice-ai-reception']],
    ['can I automate Instagram DMs?', ['help-automation-voice-instagram', 'site-feature-instagram-quickflows']],
    ['which automation replies first?', ['help-automation-overview', 'help-automation-keyword-triggers']],
  ],
  'Billing and wallet': [
    ['how much does a marketing message cost?', ['message-rate-card', 'help-message-pricing']],
    ['how do I top up my wallet?', ['help-wallet-recharge']],
    ['do I get refunded for unsent messages?', ['help-campaign-billing', 'site-feature-billing-you-can-audit']],
    ['where can I see my transaction history?', ['help-wallet-ledger-invoices', 'help-wallet-recharge']],
    ['how do I download an invoice?', ['help-wallet-ledger-invoices']],
    ['what happens when I exceed my message quota?', ['help-message-pricing', 'plan-catalog', 'plan-free', 'plan-basic', 'plan-growth']],
  ],
  'Plans': [
    ['what plans do you offer?', ['plan-catalog', 'site-plan-basic', 'site-plan-growth']],
    ['how much is the Growth plan?', ['plan-growth', 'plan-catalog', 'site-plan-growth']],
    ['what is included in the free plan?', ['plan-free', 'plan-catalog']],
    ['how do I upgrade my plan?', ['help-plans-subscription']],
    ['how many team members can I have?', ['plan-catalog', 'plan-free', 'plan-basic', 'plan-growth', 'help-team-members']],
    ['how do I get Enterprise pricing?', ['site-plan-enterprise', 'help-plans-subscription', 'help-support', 'plan-catalog']],
  ],
  'Team and settings': [
    ['how do I invite a team member?', ['help-team-members']],
    ['what roles are there?', ['help-team-members']],
    ['how do I turn on email notifications?', ['help-settings-notifications']],
    ['how do I block a number?', ['help-opt-outs']],
    ['what happens when someone replies STOP?', ['help-opt-outs', 'site-faq-what-if-someone-wants-to-stop-hearing-from-us']],
  ],
  'Developers': [
    ['how do I create an API key?', ['help-api-keys']],
    ['can I rotate or revoke an API key?', ['help-api-keys']],
    ['what can the public API do?', ['help-api-keys']],
    ['how do I set up a webhook?', ['help-webhooks']],
    ['what is the verify token for?', ['help-webhooks']],
    ['how do I connect an integration?', ['help-integrations', 'site-feature-api-webhooks-integrations']],
  ],
  'Analytics': [
    ['what analytics do you provide?', ['help-analytics', 'site-feature-delivery-and-revenue']],
    ['why are my delivered counts low?', ['help-analytics', 'help-troubleshooting']],
    ['what is chat analysis?', ['help-analytics']],
  ],
  'Security, support, about': [
    ['is my data secure?', ['help-security-data', 'site-faq-who-can-see-my-data']],
    ['are access tokens encrypted?', ['help-security-data', 'site-faq-who-can-see-my-data']],
    ['how do I contact support?', ['help-support', 'site-contact']],
    ['what is Spandan?', ['site-about', 'site-overview']],
    ['what industries use this?', ['site-use-cases']],
  ],
  'Troubleshooting': [
    ['why is my campaign not launching?', ['help-troubleshooting', 'help-create-campaign', 'help-campaign-billing', 'help-wallet-recharge']],
    ['my workflow did not run', ['help-troubleshooting', 'help-automation-workflows']],
    ['no templates show in the campaign builder', ['help-troubleshooting', 'help-templates-approval', 'help-create-campaign']],
    ['the AI agent will not deploy', ['help-troubleshooting', 'help-automation-ai-agent']],
  ],
};

const OFF_TOPIC = [
  'Who is the Prime Minister of India?',
  'What is the weather in Mumbai?',
  'Write a python script to sort a list',
  'What is the capital of France?',
  'Tell me a joke',
  'How do I cook biryani?',
  'Who won the cricket world cup?',
  'What is 25 times 4?',
  'Recommend a good laptop',
  'Translate hello into Spanish',
];

let pass = 0;
let fail = 0;
const failures = [];

for (const [group, cases] of Object.entries(CASES)) {
  console.log(`\n── ${group} ${'─'.repeat(Math.max(0, 58 - group.length))}`);
  for (const [q, expected] of cases) {
    const res = await retrieve(q, { limit: CONTEXT_WINDOW });
    const top = res.hits[0]?.chunk.docId;
    const guarded = passes(res);
    const routed = expected.includes(top);
    const inContext = res.hits.some((h) => expected.includes(h.chunk.docId));
    const ok = guarded && (routed || inContext);
    if (ok) pass++; else { fail++; failures.push([group, q, top, res]); }
    const mark = !guarded ? 'REFUSED ' : routed ? 'ok      ' : inContext ? 'ok(ctx) ' : 'MISROUTE';
    console.log(`  ${mark} ${q.padEnd(48)} -> ${top ?? '(none)'}`);
  }
}

console.log(`\n── Off-topic (must refuse) ${'─'.repeat(38)}`);
let refusedOk = 0;
for (const q of OFF_TOPIC) {
  const res = await retrieve(q, { limit: 1 });
  const refused = !passes(res);
  if (refused) { refusedOk++; pass++; } else { fail++; failures.push(['Off-topic', q, res.hits[0]?.chunk.docId, res]); }
  console.log(`  ${refused ? 'refused ' : 'LEAKED  '} ${q.padEnd(48)} cov ${res.coverage.toFixed(2)} sem ${res.bestSemantic.toFixed(2)}`);
}

const total = pass + fail;
console.log(`\n${'═'.repeat(64)}`);
console.log(`In-scope routed: ${total - OFF_TOPIC.length - failures.filter(f => f[0] !== 'Off-topic').length}/${total - OFF_TOPIC.length}`);
console.log(`Off-topic refused: ${refusedOk}/${OFF_TOPIC.length}`);
console.log(`TOTAL: ${pass}/${total} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const [g, q, top, res] of failures) {
    console.log(`  [${g}] "${q}"`);
    console.log(`      top=${top} cov=${res.coverage.toFixed(2)} sem=${res.bestSemantic.toFixed(2)}`);
  }
}
process.exitCode = fail ? 1 : 0;
