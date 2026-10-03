import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { realtimeOnWrite } from './realtimeOnWrite.js';

function run(method, path, status, workspaceId = 'wsA') {
  const calls = [];
  const mw = realtimeOnWrite((args) => calls.push(args));
  const req = { method, path, params: { workspaceId } };
  const res = new EventEmitter();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  // The router moves on before the response finishes.
  req.path = '/'; req.params = {};
  res.statusCode = status;
  res.emit('finish');
  return { calls, nexted };
}

test('a successful write announces the workspace and the resource id it touched', () => {
  assert.deepEqual(run('PATCH', '/camp_1/pause', 200).calls, [{ workspaceId: 'wsA', id: 'camp_1' }]);
  assert.deepEqual(run('POST', '/', 201).calls, [{ workspaceId: 'wsA', id: null }]);
});

test('reads and refused writes announce nothing', () => {
  const read = run('GET', '/camp_1', 200);
  assert.equal(read.nexted, true);
  assert.deepEqual(read.calls, []);
  assert.deepEqual(run('POST', '/camp_1/launch', 402).calls, []);
  assert.deepEqual(run('DELETE', '/camp_1', 403).calls, []);
});

test('a failing publisher never breaks the response', () => {
  const mw = realtimeOnWrite(() => { throw new Error('bus down'); });
  const res = new EventEmitter();
  mw({ method: 'POST', path: '/', params: { workspaceId: 'wsA' } }, res, () => {});
  res.statusCode = 200;
  assert.doesNotThrow(() => res.emit('finish'));
});
