// Shared harness for CRM HTTP tests (CF-163): the real routers, validate() and
// authorize() run against an in-memory prisma stand-in, with only identity
// mocked. A test picks the caller with headers:
//
//   x-test-user  user id   (default 'u1')
//   x-test-role  workspace role (default 'ADMIN')
//
// Not a *.test.js file, so the runner does not execute it on its own.

// Prisma-style where matching: equality, null, { in, notIn, not, equals,
// contains, gte, lte, gt, lt }, JSON { path, equals }, AND / OR / NOT.
// Relation filters ({ is, isNot, some, every, none }) pass unless the store
// was given that relation (createStore's `relations`): `related(key, row)`
// resolves one to { value, match }, or null when it is not modelled.
export function matchesWhere(row, where = {}, related = null) {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((w) => matchesWhere(row, w, related));
    if (key === 'OR') return cond.some((w) => matchesWhere(row, w, related));
    if (key === 'NOT') return !(Array.isArray(cond) ? cond : [cond]).some((w) => matchesWhere(row, w, related));
    const value = row[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return (value ?? null) === cond;
    if ('is' in cond || 'some' in cond || 'none' in cond || 'every' in cond || 'isNot' in cond) {
      const link = related?.(key, row);
      if (!link) return true;
      const { value: rel, match } = link;
      if ('is' in cond) return cond.is === null ? rel == null : rel != null && match(rel, cond.is);
      if ('isNot' in cond) return cond.isNot === null ? rel != null : !(rel != null && match(rel, cond.isNot));
      if ('some' in cond) return rel.some((r) => match(r, cond.some));
      if ('every' in cond) return rel.every((r) => match(r, cond.every));
      return !rel.some((r) => match(r, cond.none));
    }
    if (Array.isArray(cond.path)) {
      const at = cond.path.reduce((v, p) => (v == null ? undefined : v[p]), value);
      return 'equals' in cond ? (at ?? null) === cond.equals : true;
    }
    if ('in' in cond && !cond.in.includes(value)) return false;
    if ('notIn' in cond && cond.notIn.includes(value)) return false;
    if ('equals' in cond && (value ?? null) !== cond.equals) return false;
    if ('not' in cond) {
      if (cond.not !== null && typeof cond.not === 'object') { if (matchesWhere(row, { [key]: cond.not })) return false; }
      else if ((value ?? null) === cond.not) return false;
    }
    if ('contains' in cond && !String(value ?? '').toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
    if ('gte' in cond && !(value >= cond.gte)) return false;
    if ('lte' in cond && !(value <= cond.lte)) return false;
    if ('gt' in cond && !(value > cond.gt)) return false;
    if ('lt' in cond && !(value < cond.lt)) return false;
    return true;
  });
}

const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

/**
 * An in-memory database. `uniques` lists, per model, the field sets that must
 * be unique (id always is); `defaults` the column defaults a create fills in.
 * `findUnique` accepts `{ id }` or a compound key such as
 * `{ userId_workspaceId: { … } }`.
 *
 * `relations` opts a model's relation filters into being evaluated instead of
 * passing: `{ model: { field: { model, from } | { model, to, many } } }`, where
 * `from` names this row's foreign key to the other row's id, and `to` the
 * other row's foreign key to this row's id (`many` for a list relation).
 */
export function createStore({ uniques = {}, defaults = {}, relations = {} } = {}) {
  const tables = {};
  let seq = 0;
  const rows = (model) => (tables[model] ??= []);

  const relatedFor = (model) => (key, row) => {
    const r = relations[model]?.[key];
    if (!r) return null;
    const linked = rows(r.model).filter((o) => (r.from ? o.id === row[r.from] : o[r.to] === row.id));
    return {
      value: r.many ? linked : (linked[0] ?? null),
      match: (o, w) => matchesWhere(o, w, relatedFor(r.model)),
    };
  };

  const keyWhere = (where) => {
    const out = {};
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && k.includes('_')) Object.assign(out, v);
      else out[k] = v;
    }
    return out;
  };

  const assertUnique = (model, candidate, self = null) => {
    for (const fields of uniques[model] ?? []) {
      const clash = rows(model).some((r) => r !== self && fields.every((f) => r[f] != null && r[f] === candidate[f]));
      if (clash) throw p2002();
    }
  };

  const insert = (model, data) => {
    const row = { id: data.id ?? `${model}_${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...(defaults[model] || {}), ...data };
    assertUnique(model, row);
    rows(model).push(row);
    return row;
  };

  // Reads hand out copies, as a real client does: a caller holding a row must
  // not see a later write change it underneath them.
  const copy = (row) => (row ? { ...row } : null);

  const delegate = (model) => {
    const matches = (r, where) => matchesWhere(r, where, relatedFor(model));
    return {
      findMany: async ({ where, take, skip } = {}) => rows(model).filter((r) => matches(r, where)).slice(skip ?? 0, take ? (skip ?? 0) + take : undefined).map(copy),
      findFirst: async ({ where } = {}) => copy(rows(model).find((r) => matches(r, where))),
      findUnique: async ({ where }) => copy(rows(model).find((r) => matches(r, keyWhere(where)))),
      count: async ({ where } = {}) => rows(model).filter((r) => matches(r, where)).length,
      create: async ({ data }) => copy(insert(model, data)),
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const d of data) {
          try { insert(model, d); count += 1; } catch (err) { if (!skipDuplicates) throw err; }
        }
        return { count };
      },
      createManyAndReturn: async ({ data, skipDuplicates }) => {
        const out = [];
        for (const d of data) {
          try { out.push(copy(insert(model, d))); } catch (err) { if (!skipDuplicates) throw err; }
        }
        return out;
      },
      update: async ({ where, data }) => {
        const row = rows(model).find((r) => matches(r, keyWhere(where)));
        if (!row) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
        const next = { ...row, ...data, updatedAt: new Date() };
        assertUnique(model, next, row);
        return copy(Object.assign(row, next));
      },
      updateMany: async ({ where, data }) => {
        const hit = rows(model).filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data, { updatedAt: new Date() });
        return { count: hit.length };
      },
      upsert: async ({ where, create, update }) => {
        const row = rows(model).find((r) => matches(r, keyWhere(where)));
        return copy(row ? Object.assign(row, update) : insert(model, create));
      },
      delete: async ({ where }) => {
        const i = rows(model).findIndex((r) => matches(r, keyWhere(where)));
        if (i < 0) throw Object.assign(new Error('Record to delete does not exist'), { code: 'P2025' });
        return copy(rows(model).splice(i, 1)[0]);
      },
      deleteMany: async ({ where } = {}) => {
        const keep = rows(model).filter((r) => !matches(r, where));
        const count = rows(model).length - keep.length;
        tables[model] = keep;
        return { count };
      },
      groupBy: async () => [],
    };
  };

  const client = new Proxy({}, {
    get(_t, prop) {
      if (prop === '$transaction') return async (arg) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
      if (prop === '$connect' || prop === '$disconnect') return async () => {};
      if (prop === '$queryRaw' || prop === '$executeRaw') return async () => [];
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return (delegates[prop] ??= delegate(prop));
    },
  });
  const delegates = {};

  return {
    prisma: client,
    rows,
    seed: (model, ...data) => data.map((d) => insert(model, d)),
    reset: () => { for (const k of Object.keys(tables)) delete tables[k]; },
  };
}

/** Mocks identity only: authenticate + workspaceContext, chosen per request. */
export function mockIdentity(mock, { defaultRole = 'ADMIN', env = {} } = {}) {
  // Routers that reach messaging code load lib/encryption.js, which needs a key.
  mock.module('../config/env.js', {
    namedExports: { env: { ADMIN_EMAIL: 'admin@example.test', ENCRYPTION_KEY: 'k'.repeat(32), ...env } },
  });
  mock.module('../middleware/authenticate.js', {
    namedExports: {
      authenticate: (req, _res, next) => { req.user = { id: req.get('x-test-user') || 'u1' }; next(); },
      authenticateOptional: (_req, _res, next) => next(),
    },
  });
  mock.module('../middleware/workspaceContext.js', {
    namedExports: {
      workspaceContext: (req, _res, next) => {
        req.user.workspaceId = req.params.workspaceId;
        req.user.role = req.get('x-test-role') || defaultRole;
        req.user.workspaceRoleVerified = true;
        next();
      },
    },
  });
}

/** Mounts routers ({ path: router }) under /w/:workspaceId and listens. */
export async function startApp(mounts) {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json());
  for (const [path, router] of Object.entries(mounts)) app.use(`/w/:workspaceId${path}`, router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/w`;
  const call = (method, path, body, { user, role, workspace = 'ws1' } = {}) => fetch(`${base}/${workspace}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { 'x-test-user': user } : {}),
      ...(role ? { 'x-test-role': role } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { server, call };
}
