import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = '';

const { __testing } = await import('./llm.js');
const { parseJsonReply } = __testing;

// What a model returns when asked for JSON is not always only JSON.

test('plain and fenced JSON both parse', () => {
  assert.deepEqual(parseJsonReply('{"reply":"ok"}'), { reply: 'ok' });
  assert.deepEqual(parseJsonReply('```json\n{"reply":"ok"}\n```'), { reply: 'ok' });
  assert.deepEqual(parseJsonReply('```\n{"reply":"ok"}\n```'), { reply: 'ok' });
});

test('an object wrapped in a sentence or followed by stray text is still read', () => {
  assert.deepEqual(parseJsonReply('Here is the setup:\n{"reply":"ok","n":{"a":1}}\nLet me know!'), { reply: 'ok', n: { a: 1 } });
  assert.deepEqual(parseJsonReply('{"reply":"ok"}\n\n{'), { reply: 'ok' });
});

test('text that holds no usable object is null, never a throw', () => {
  assert.equal(parseJsonReply(''), null);
  assert.equal(parseJsonReply('I cannot help with that.'), null);
  assert.equal(parseJsonReply('{"reply": "unterminated'), null);
});
