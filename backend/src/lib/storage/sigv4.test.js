import test from 'node:test';
import assert from 'node:assert/strict';
import { signRequest, presignUrl, uriEncode, encodeKeyPath, sha256Hex, EMPTY_SHA256 } from './sigv4.js';

// Every expected value below is copied from AWS's published examples, not
// produced by this code: the SigV4 test suite (get-vanilla family, credentials
// AKIDEXAMPLE) and the S3 "Signature Calculations for the Authorization Header"
// and "Query String Authentication" examples (examplebucket, AKIAIOSFODNN7EXAMPLE).

const SUITE_CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const SUITE_SCOPE = { region: 'us-east-1', service: 'service', date: new Date('2015-08-30T12:36:00Z') };

const S3_CREDS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const S3_SCOPE = { region: 'us-east-1', service: 's3', date: new Date('2013-05-24T00:00:00Z') };
const S3_HOST = 'examplebucket.s3.amazonaws.com';

test('sigv4 suite: get-vanilla', () => {
  const { headers, signature } = signRequest(
    { method: 'GET', path: '/', headers: { Host: 'example.amazonaws.com' } },
    SUITE_CREDS, SUITE_SCOPE,
  );
  assert.equal(signature, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(
    headers.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, '
      + 'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
  assert.equal(headers['x-amz-date'], '20150830T123600Z');
  assert.equal(headers['x-amz-content-sha256'], undefined, 'only S3 adds the payload hash header');
});

test('sigv4 suite: get-vanilla-query-order-key-case (query sorted by name)', () => {
  const { signature } = signRequest(
    { method: 'GET', path: '/', query: [['Param2', 'value2'], ['Param1', 'value1']], headers: { Host: 'example.amazonaws.com' } },
    SUITE_CREDS, SUITE_SCOPE,
  );
  assert.equal(signature, 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
});

test('sigv4 suite: post-vanilla', () => {
  const { signature } = signRequest(
    { method: 'POST', path: '/', headers: { Host: 'example.amazonaws.com' } },
    SUITE_CREDS, SUITE_SCOPE,
  );
  assert.equal(signature, '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b');
});

test('S3 example: GET object with a Range header', () => {
  const { headers, signature } = signRequest(
    { method: 'GET', path: '/test.txt', headers: { Host: S3_HOST, Range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256 },
    S3_CREDS, S3_SCOPE,
  );
  assert.equal(signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.match(headers.Authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  assert.equal(headers['x-amz-content-sha256'], EMPTY_SHA256);
});

test('S3 example: PUT object with a body, an encoded key and extra signed headers', () => {
  const body = 'Welcome to Amazon S3.';
  const payloadHash = sha256Hex(body);
  assert.equal(payloadHash, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const { signature } = signRequest(
    {
      method: 'PUT',
      path: `/${encodeKeyPath('test$file.text')}`,
      headers: {
        Host: S3_HOST,
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash,
    },
    S3_CREDS, S3_SCOPE,
  );
  assert.equal(signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('S3 example: GET bucket lifecycle (a value-less sub-resource)', () => {
  const { signature } = signRequest(
    { method: 'GET', path: '/', query: { lifecycle: '' }, headers: { Host: S3_HOST }, payloadHash: EMPTY_SHA256 },
    S3_CREDS, S3_SCOPE,
  );
  assert.equal(signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});

test('S3 example: list objects with query parameters', () => {
  const { signature } = signRequest(
    { method: 'GET', path: '/', query: { 'max-keys': '2', prefix: 'J' }, headers: { Host: S3_HOST }, payloadHash: EMPTY_SHA256 },
    S3_CREDS, S3_SCOPE,
  );
  assert.equal(signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('S3 example: presigned GET URL valid for 24 hours', () => {
  const { url, signature } = presignUrl(
    { host: S3_HOST, path: '/test.txt' },
    S3_CREDS,
    { ...S3_SCOPE, expiresIn: 86400 },
  );
  assert.equal(signature, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  assert.equal(
    url,
    'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
      + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host'
      + '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
});

test('a session token is signed into the request', () => {
  const { headers } = signRequest(
    { method: 'GET', path: '/k', headers: { Host: S3_HOST } },
    { ...S3_CREDS, sessionToken: 'tok' }, S3_SCOPE,
  );
  assert.equal(headers['x-amz-security-token'], 'tok');
  assert.match(headers.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,/);
});

test('uriEncode follows the SigV4 unreserved set', () => {
  assert.equal(uriEncode('a b+c/d~e_f.g-h*'), 'a%20b%2Bc%2Fd~e_f.g-h%2A');
  assert.equal(uriEncode('a/b', { keepSlash: true }), 'a/b');
  assert.equal(uriEncode('é'), '%C3%A9');
  assert.equal(encodeKeyPath('ws 1/a$b.png'), 'ws%201/a%24b.png');
});
