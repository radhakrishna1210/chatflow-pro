import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsSchemas } from './index.js';

// The lead-capture switch PATCHes `autoLeadFromReply`. Zod strips unknown keys,
// so before the field was declared the request "succeeded" with an empty
// update and the setting never changed.
test('the settings update keeps autoLeadFromReply', () => {
  assert.deepEqual(settingsSchemas.update.parse({ autoLeadFromReply: true }), { autoLeadFromReply: true });
  assert.deepEqual(settingsSchemas.update.parse({ autoLeadFromReply: false }), { autoLeadFromReply: false });
  assert.equal(settingsSchemas.update.safeParse({ autoLeadFromReply: 'yes' }).success, false);
});
