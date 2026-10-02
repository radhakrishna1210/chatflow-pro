import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// A setting changed by another process (the other deployment, the worker
// process) must reach this process without a restart, and a value that cannot
// be decrypted must be reported rather than silently ignored.
const db = { rows: [], findManyCalls: 0 };

mock.module('../lib/prisma.js', {
  namedExports: {
    prisma: {
      systemSetting: {
        findMany: async () => { db.findManyCalls += 1; return db.rows.map((r) => ({ ...r })); },
        aggregate: async () => ({
          _count: { _all: db.rows.length },
          _max: { updatedAt: db.rows.reduce((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null) },
        }),
      },
    },
  },
});

mock.module('../lib/encryption.js', {
  namedExports: {
    encrypt: (v) => `enc:${v}`,
    decrypt: (v) => {
      if (!v.startsWith('enc:')) throw new Error('bad decrypt');
      return v.slice(4);
    },
  },
});

const { getSystemSetting } = await import('../config/settingsStore.js');
const { loadPlatformSettings, startPlatformSettingsRefresh, platformSettingsStatus } = await import('./platformSettings.service.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = () => {
  const saved = [console.log, console.error];
  console.log = () => {};
  console.error = () => {};
  return () => { [console.log, console.error] = saved; };
};

test('a change written by another process is picked up by the refresh poll', async () => {
  const restore = quiet();
  try {
    db.rows = [{ key: 'GEMINI_API_KEY', value: 'enc:first', updatedAt: new Date('2026-01-01T00:00:00Z') }];
    await loadPlatformSettings();
    assert.equal(getSystemSetting('GEMINI_API_KEY'), 'first');

    const timer = startPlatformSettingsRefresh(10);
    try {
      const callsBefore = db.findManyCalls;
      await sleep(40);
      assert.equal(db.findManyCalls, callsBefore, 'no reload while nothing changed');

      db.rows = [{ key: 'GEMINI_API_KEY', value: 'enc:second', updatedAt: new Date('2026-01-02T00:00:00Z') }];
      await sleep(60);
      assert.equal(getSystemSetting('GEMINI_API_KEY'), 'second');

      db.rows = [];
      await sleep(60);
      assert.equal(getSystemSetting('GEMINI_API_KEY'), undefined, 'a cleared override falls back to the environment');
    } finally {
      clearInterval(timer);
    }
  } finally {
    restore();
  }
});

test('an override that cannot be decrypted is named, not just counted', async () => {
  const restore = quiet();
  try {
    db.rows = [
      { key: 'SMTP_PASSWORD', value: 'garbage', updatedAt: new Date() },
      { key: 'OPENAI_API_KEY', value: 'enc:ok', updatedAt: new Date() },
    ];
    await loadPlatformSettings();
    assert.equal(getSystemSetting('SMTP_PASSWORD'), undefined);
    assert.equal(getSystemSetting('OPENAI_API_KEY'), 'ok');
  } finally {
    restore();
  }
  const status = platformSettingsStatus();
  assert.deepEqual(status.unreadable, ['SMTP_PASSWORD']);
  assert.equal(status.loaded, 1);
});
