import test from 'node:test';
import assert from 'node:assert/strict';

// WF-EN-9 and WF-EN-12 at the Meta client: every Graph call is bounded by a
// timeout (a hung send outlived the 10-minute workflow run lease and was sent
// again), and two options that clip to the same title are not sent as
// identical buttons.
const axios = (await import('axios')).default;
const meta = await import('./meta.js');

test('the Meta client has a request timeout well inside the run lease', () => {
  const client = meta.metaClient('token');
  assert.ok(client.defaults.timeout > 0 && client.defaults.timeout < 10 * 60_000, `timeout ${client.defaults.timeout}`);
  assert.equal(client.defaults.timeout, meta.metaTimeoutMs());
});

test('uniqueTitles clips to the limit and numbers clashes inside it', () => {
  const titles = meta.uniqueTitles(['Talk to support team (billing)', 'Talk to support team (technical)', 'Talk to support team!'], 20);
  assert.equal(new Set(titles.map((t) => t.toLowerCase())).size, 3);
  assert.ok(titles.every((t) => t.length <= 20));
  assert.equal(titles[0], 'Talk to support team');
  assert.match(titles[1], / 2$/);
  assert.match(titles[2], / 3$/);
});

async function capturePosts(fn) {
  const posts = [];
  const realCreate = axios.create;
  axios.create = () => ({ post: async (url, body) => { posts.push(body); return { data: { messages: [{ id: 'w' }] } }; } });
  try { await fn(); } finally { axios.create = realCreate; }
  return posts;
}

test('two options sharing their first 20 characters go out as distinct reply buttons', async () => {
  const posts = await capturePosts(() => meta.sendButtonMessage('pn', 'tok', '+91980', {
    body: 'How can we help?',
    buttons: ['Talk to support team (billing)', 'Talk to support team (technical)'],
  }));
  const titles = posts[0].interactive.action.buttons.map((b) => b.reply.title);
  assert.equal(new Set(titles).size, titles.length);
});

test('list rows sharing their first 24 characters go out as distinct rows', async () => {
  const rows = ['Order status for my parcel A', 'Order status for my parcel B', 'Refund', 'Other'];
  const posts = await capturePosts(() => meta.sendListMessage('pn', 'tok', '+91980', { body: 'Pick one', rows }));
  const titles = posts[0].interactive.action.sections[0].rows.map((r) => r.title);
  assert.equal(new Set(titles).size, 4);
  assert.ok(titles.every((t) => t.length <= 24));
});
