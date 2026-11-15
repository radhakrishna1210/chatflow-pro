import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Which Gemini model a call uses: the platform default, a platform default
// changed from Super Admin, or a workspace's own model. The Google SDK is
// replaced with a recorder, so these tests see the model id each call was
// actually sent with — which is the only thing that proves the setting reaches
// the provider.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const calls = [];          // model id of every generateContent call, in order
let failFor = () => null;  // (model) => Error | null
mock.module('@google/genai', {
  namedExports: {
    GoogleGenAI: class {
      constructor() {
        this.models = {
          generateContent: async ({ model }) => {
            calls.push(model);
            const err = failFor(model);
            if (err) throw err;
            return { text: `answer from ${model}` };
          },
        };
      }
    },
  },
});

const { setSystemSettings } = await import('../config/settingsStore.js');
const { env } = await import('../config/env.js');
const { prisma } = await import('./prisma.js');
const aiModel = await import('./aiModel.js');
const { llmText } = await import('./llm.js');
const { workspaceContext, workspaceAiModelContext } = await import('../middleware/workspaceContext.js');

const DEFAULT = env.GEMINI_MODEL;           // whatever the environment defaults to
const FALLBACK = env.GEMINI_FALLBACK_MODEL;

// Workspace rows the lookup helper reads.
const workspaces = { ws_pro: { aiModel: 'gemini-pro-x' }, ws_plain: { aiModel: null } };
let lookups = 0;
prisma.workspace.findUnique = async ({ where }) => { lookups += 1; return workspaces[where.id] ?? null; };

test.beforeEach(() => {
  calls.length = 0;
  failFor = () => null;
  lookups = 0;
  setSystemSettings({ GEMINI_API_KEY: 'test-key' });
  aiModel.forgetWorkspaceAiModel();
});

// ── Platform default ────────────────────────────────────────────────────────

test('with no override a call uses the platform default model', async () => {
  assert.equal(await llmText('hi'), `answer from ${DEFAULT}`);
  assert.deepEqual(calls, [DEFAULT]);
  assert.equal(aiModel.activeModel(), DEFAULT);
});

test('changing the platform default in Super Admin changes the model on the next call, no restart', async () => {
  setSystemSettings({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-new-default', GEMINI_FALLBACK_MODEL: 'gemini-new-fallback' });

  await llmText('hi');
  assert.deepEqual(calls, ['gemini-new-default']);
  assert.deepEqual(aiModel.modelChain(), ['gemini-new-default', 'gemini-new-fallback']);

  // Clearing the override falls back to the environment's value.
  setSystemSettings({ GEMINI_API_KEY: 'test-key' });
  calls.length = 0;
  await llmText('hi');
  assert.deepEqual(calls, [DEFAULT]);
});

// ── Workspace override ──────────────────────────────────────────────────────

test('inside a workspace context every call uses that workspace\'s model', async () => {
  const reply = await aiModel.runWithAiModel('gemini-pro-x', async () => {
    await new Promise((r) => setTimeout(r, 5));   // survives real async gaps
    return llmText('hi');
  });
  assert.equal(reply, 'answer from gemini-pro-x');
  assert.deepEqual(calls, ['gemini-pro-x']);
});

test('the override does not leak out of its context', async () => {
  await aiModel.runWithAiModel('gemini-pro-x', () => llmText('inside'));
  await llmText('outside');
  assert.deepEqual(calls, ['gemini-pro-x', DEFAULT]);
});

test('two workspaces working at the same time each keep their own model', async () => {
  const work = (model, delay) => aiModel.runWithAiModel(model, async () => {
    await new Promise((r) => setTimeout(r, delay));
    return llmText('hi');
  });
  const [a, b, c] = await Promise.all([work('model-a', 15), work('model-b', 1), work(null, 8)]);
  assert.equal(a, 'answer from model-a');
  assert.equal(b, 'answer from model-b');
  assert.equal(c, `answer from ${DEFAULT}`, 'a workspace with no override stays on the default');
});

test('an empty or malformed override means the platform default, not a broken call', async () => {
  for (const bad of [null, undefined, '', '   ', 'not a model id!', 'x'.repeat(200)]) {
    calls.length = 0;
    await aiModel.runWithAiModel(bad, () => llmText('hi'));
    assert.deepEqual(calls, [DEFAULT], `override ${JSON.stringify(bad)}`);
  }
});

test('a "models/" prefix is accepted and stripped', () => {
  assert.equal(aiModel.cleanModelId('models/gemini-flash-latest'), 'gemini-flash-latest');
  assert.equal(aiModel.cleanModelId('  gemini-2.5-pro '), 'gemini-2.5-pro');
  assert.equal(aiModel.cleanModelId('gemini pro'), null);
});

test('a pinned model that Google has retired falls back to the platform default instead of going silent', async () => {
  failFor = (model) => (model === 'gemini-retired' ? new Error('404 models/gemini-retired is not found') : null);

  const reply = await aiModel.runWithAiModel('gemini-retired', () => llmText('hi'));

  assert.equal(reply, `answer from ${DEFAULT}`);
  assert.deepEqual(calls, ['gemini-retired', DEFAULT], 'a 404 is permanent: tried once, then the next model');
});

test('the chain is workspace model, then platform default, then platform fallback', () => {
  aiModel.runWithAiModel('gemini-pro-x', () => {
    assert.deepEqual(aiModel.modelChain(), ['gemini-pro-x', DEFAULT, FALLBACK]);
    assert.equal(aiModel.workspaceModelOverride(), 'gemini-pro-x');
  });
  assert.deepEqual(aiModel.modelChain(), [DEFAULT, FALLBACK]);
  assert.equal(aiModel.workspaceModelOverride(), null);
  // Pinning a workspace to the platform default does not try it twice.
  aiModel.runWithAiModel(DEFAULT, () => assert.deepEqual(aiModel.modelChain(), [DEFAULT, FALLBACK]));
});

// ── Looking the workspace up ────────────────────────────────────────────────

test('work started outside a request picks the model up by workspace id, and caches it', async () => {
  await aiModel.runWithWorkspaceAiModel('ws_pro', () => llmText('hi'));
  await aiModel.runWithWorkspaceAiModel('ws_pro', () => llmText('hi'));
  await aiModel.runWithWorkspaceAiModel('ws_plain', () => llmText('hi'));
  await aiModel.runWithWorkspaceAiModel(null, () => llmText('hi'));

  assert.deepEqual(calls, ['gemini-pro-x', 'gemini-pro-x', DEFAULT, DEFAULT]);
  assert.equal(lookups, 2, 'one lookup per workspace, not per call');
});

test('a change made in Super Admin is live at once, not after the cache expires', async () => {
  await aiModel.runWithWorkspaceAiModel('ws_pro', () => llmText('hi'));
  workspaces.ws_pro.aiModel = 'gemini-changed';
  aiModel.forgetWorkspaceAiModel('ws_pro');          // what setWorkspaceAiModel does
  await aiModel.runWithWorkspaceAiModel('ws_pro', () => llmText('hi'));
  assert.deepEqual(calls, ['gemini-pro-x', 'gemini-changed']);
  workspaces.ws_pro.aiModel = 'gemini-pro-x';
});

test('a failed lookup uses the platform default rather than failing the reply', async () => {
  const original = prisma.workspace.findUnique;
  prisma.workspace.findUnique = async () => { throw new Error('db down'); };
  const reply = await aiModel.runWithWorkspaceAiModel('ws_pro', () => llmText('hi'));
  prisma.workspace.findUnique = original;
  assert.equal(reply, `answer from ${DEFAULT}`);
});

// ── The request middleware ──────────────────────────────────────────────────

test('a workspace-scoped request runs its handler under the workspace\'s model', async () => {
  prisma.workspaceMember.findUnique = async () => ({
    role: 'ADMIN',
    workspace: { id: 'ws_pro', suspended: false, subscription: { status: 'ACTIVE' }, aiModel: 'gemini-pro-x' },
  });
  const req = { params: { workspaceId: 'ws_pro' }, user: { id: 'u1' }, method: 'POST', baseUrl: '/api/v1/workspaces/ws_pro/workflows', path: '/generate' };
  let seen = null;

  // The handler does its AI work after an await, as real handlers do.
  await new Promise((resolve) => {
    workspaceContext(req, {}, async () => {
      await new Promise((r) => setTimeout(r, 3));
      seen = await llmText('build me a workflow');
      resolve();
    });
  });

  assert.equal(seen, 'answer from gemini-pro-x');
});

test('routes outside /workspaces/:id (onboarding, /ai) take the workspace from the caller\'s token', async () => {
  let seen = null;
  await new Promise((resolve) => {
    workspaceAiModelContext({ user: { id: 'u1', workspaceId: 'ws_pro' } }, {}, async () => {
      seen = await llmText('set everything up');
      resolve();
    });
  });
  assert.equal(seen, 'answer from gemini-pro-x');

  // No workspace on the token yet (a brand-new signup): platform default.
  await new Promise((resolve) => {
    workspaceAiModelContext({ user: { id: 'u2', workspaceId: null } }, {}, async () => {
      seen = await llmText('hello');
      resolve();
    });
  });
  assert.equal(seen, `answer from ${DEFAULT}`);
});
