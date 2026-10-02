import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness } from './aiAgent.service.js';

const knowledgeCheck = (r) => r.checks.find((c) => c.id === 'knowledge');

test('readiness counts only the knowledge the agent is actually given', () => {
  // Indexed widget sources are not part of this agent's prompt, so they no
  // longer make the knowledge step look done.
  const withoutNotes = readiness({ ws: { aiAgentKnowledge: '' }, knowledgeSourceCount: 5, intentRuleCount: 0 });
  assert.equal(knowledgeCheck(withoutNotes).done, false);

  const withNotes = readiness({
    ws: { aiAgentKnowledge: 'Business hours: Mon-Sat 9am-7pm. Returns within 7 days with receipt.' },
    intentRuleCount: 0,
  });
  assert.equal(knowledgeCheck(withNotes).done, true);
  assert.equal(withNotes.score - withoutNotes.score, 25);
});
