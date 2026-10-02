import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// What the copilot sends to the model provider about the person asking: their
// display name, never their email or user id.

const prompts = [];
mock.module('../lib/llm.js', {
  namedExports: {
    llmAvailable: () => true,
    llmJson: async (prompt, system) => { prompts.push({ prompt, system }); return { answer: 'Done.' }; },
    llmText: async () => null,
  },
});

const { prisma } = await import('../lib/prisma.js');
prisma.user.findUnique = async () => ({ name: 'Asha Rao' });

const { ask } = await import('./copilot.service.js');
const { resolveMe } = await import('./copilot.tools.js');

test('the system prompt carries the name but not the email or user id', async () => {
  prompts.length = 0;
  const user = { id: 'user_secret_123', email: 'asha@example.com', name: null, role: 'ADMIN' };
  const out = await ask('ws_privacy', user, 'What is on my plate today?');
  assert.equal(out.answer, 'Done.');
  assert.equal(prompts.length, 1);
  const { system } = prompts[0];
  assert.match(system, /Asha Rao/);
  assert.equal(system.includes('asha@example.com'), false);
  assert.equal(system.includes('user_secret_123'), false);
});

test('"me" in a user-id argument resolves to the asking user server-side', () => {
  const user = { id: 'u_42' };
  assert.deepEqual(resolveMe({ ownerUserId: 'me', ticketId: 'me' }, user), { ownerUserId: 'u_42', ticketId: 'me' });
  assert.deepEqual(resolveMe({ assignedToUserId: ' Me ' }, user), { assignedToUserId: 'u_42' });
  assert.deepEqual(resolveMe({ ownerUserId: 'u_other' }, user), { ownerUserId: 'u_other' });
});
