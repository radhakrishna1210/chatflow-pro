import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { safeEqual, checkMetaSignature, answerChallenge } from './webhook.controller.js';
import { isMetaCdnUrl } from '../lib/meta.js';

const SECRET = 'unit-test-secret';
const sign = (buf) => 'sha256=' + createHmac('sha256', SECRET).update(buf).digest('hex');

test('safeEqual compares strings and refuses non-strings', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual(['abc'], 'abc'), false);
});

test('checkMetaSignature accepts only an HMAC of the exact raw bytes', () => {
  const raw = Buffer.from('{"entry":[{"x":"café"}]}');
  assert.equal(checkMetaSignature({ headers: { 'x-hub-signature-256': sign(raw) }, rawBody: raw }, SECRET), null);
  assert.equal(checkMetaSignature({ headers: { 'x-hub-signature-256': sign(raw) }, rawBody: Buffer.from('{}') }, SECRET), 'Invalid signature');
  assert.equal(checkMetaSignature({ headers: {}, rawBody: raw }, SECRET), 'Missing signature');
  assert.equal(checkMetaSignature({ headers: { 'x-hub-signature-256': 'sha256=00' }, rawBody: raw }, SECRET), 'Invalid signature');
  // A non-JSON request never got a raw body — it must not 500, and must not pass.
  assert.equal(checkMetaSignature({ headers: { 'x-hub-signature-256': sign(raw) } }, SECRET), 'Invalid signature');
  // No secret configured is never "valid".
  assert.notEqual(checkMetaSignature({ headers: { 'x-hub-signature-256': sign(raw) }, rawBody: raw }, ''), null);
});

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.type = (t) => { res.headers['content-type'] = t; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('the hub.challenge echo is plain text and needs the exact token', () => {
  const ok = fakeRes();
  answerChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '<script>1</script>' } }, ok, 'tok').send();
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'text/plain');
  assert.equal(ok.body, '<script>1</script>');

  const wrong = fakeRes();
  answerChallenge({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'to', 'hub.challenge': '1' } }, wrong, 'tok').send();
  assert.equal(wrong.statusCode, 403);

  // An unset server token must never match a request that simply omits one.
  const unset = fakeRes();
  answerChallenge({ query: { 'hub.mode': 'subscribe', 'hub.challenge': '1' } }, unset, undefined).send();
  assert.equal(unset.statusCode, 403);
});

test('isMetaCdnUrl allows Meta media hosts over https only', () => {
  assert.equal(isMetaCdnUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'), true);
  assert.equal(isMetaCdnUrl('https://scontent.whatsapp.net/v/t61/abc.jpg'), true);
  assert.equal(isMetaCdnUrl('https://scontent-bom1-1.xx.fbcdn.net/x.jpg'), true);
  assert.equal(isMetaCdnUrl('http://lookaside.fbsbx.com/x'), false);
  assert.equal(isMetaCdnUrl('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isMetaCdnUrl('https://localhost:4000/api'), false);
  assert.equal(isMetaCdnUrl('https://evilfbcdn.net/x'), false);
  assert.equal(isMetaCdnUrl('https://fbcdn.net.evil.com/x'), false);
  assert.equal(isMetaCdnUrl('https://user:pw@lookaside.fbsbx.com/x'), false);
  assert.equal(isMetaCdnUrl('not a url'), false);
});
