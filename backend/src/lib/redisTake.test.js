// One-time values are read and deleted together, without GETDEL (Redis 6.2+).
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const commands = [];
let execResult;

let takeKey;
before(async () => {
  mock.module('./redis.js', {
    namedExports: {
      redis: {
        // GETDEL must not be used: an older Redis answers "unknown command".
        getdel: async () => { throw new Error("ERR unknown command 'getdel'"); },
        multi() {
          const queued = [];
          const chain = {
            get(key) { queued.push(['get', key]); return chain; },
            del(key) { queued.push(['del', key]); return chain; },
            async exec() {
              commands.push(queued.map((c) => c[0]).join('+'));
              if (execResult !== undefined) return execResult;
              return queued.map(([op, key]) => {
                if (op === 'get') return [null, store.has(key) ? store.get(key) : null];
                const had = store.delete(key);
                return [null, had ? 1 : 0];
              });
            },
          };
          return chain;
        },
      },
    },
  });
  ({ takeKey } = await import('./redisTake.js'));
});

test('the value is returned once and the key is gone', async () => {
  store.set('oauth:code:abc', '{"accessToken":"x"}');
  assert.equal(await takeKey('oauth:code:abc'), '{"accessToken":"x"}');
  assert.equal(store.has('oauth:code:abc'), false);
  assert.equal(await takeKey('oauth:code:abc'), null, 'a second read gets nothing');
  assert.deepEqual(commands, ['get+del', 'get+del'], 'read and delete go in one transaction');
});

test('a missing key, a discarded transaction and a failed read', async () => {
  assert.equal(await takeKey('never-set'), null);
  execResult = null;
  assert.equal(await takeKey('whatever'), null, 'a discarded transaction reads as nothing');
  execResult = [[new Error('WRONGTYPE'), null], [null, 0]];
  await assert.rejects(takeKey('whatever'), /WRONGTYPE/);
  execResult = undefined;
});
