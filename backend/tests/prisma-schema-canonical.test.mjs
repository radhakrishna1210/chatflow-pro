// Regression tests for the schema comparison in scripts/ensure-prisma-client.js.
//
// Prisma reorders declarations when it embeds schema.prisma into the generated
// client (e.g. @@unique/@@index move below relation fields). The validator must
// accept that, while still rejecting any real schema change.
//
// Run with:  npm run test:prisma-schema

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { canonicalSchema } from '../scripts/prisma-schema-canonical.js';

const same = (a, b) => assert.strictEqual(canonicalSchema(a), canonicalSchema(b));
const differ = (a, b) => assert.notStrictEqual(canonicalSchema(a), canonicalSchema(b));

const SOURCE = `
// Contacts belong to a workspace.
model Contact {
  id             String          @id @default(cuid())
  workspaceId    String
  phoneNumber    String
  widgetSessions WidgetSession[]

  @@unique([workspaceId, phoneNumber])
  @@index([workspaceId, updatedAt])
  lead   Lead?
  quotes Quote[]
}

enum Status {
  NEW
  DONE
}
`;

test('accepts Prisma moving block attributes below fields (Contact case)', () => {
  same(SOURCE, `
enum Status {
  NEW
  DONE
}

model Contact {
  id             String          @id @default(cuid())
  workspaceId    String
  phoneNumber    String
  widgetSessions WidgetSession[]
  lead           Lead?
  quotes         Quote[]

  @@unique([workspaceId, phoneNumber])
  @@index([workspaceId, updatedAt])
}
`);
});

test('accepts reordered field attributes and removed comments/whitespace', () => {
  same(
    'model A {\n  id String @id @default(cuid()) // key\n}',
    'model A {\r\n\tid String @default(cuid())   @id\r\n}',
  );
});

test('rejects a changed default value', () => {
  differ('model A {\n  id Int @default(1)\n}', 'model A {\n  id Int @default(2)\n}');
});

test('rejects a changed quoted string, including whitespace inside quotes', () => {
  differ(
    'model A {\n  m String @default("a b")\n}',
    'model A {\n  m String @default("ab")\n}',
  );
});

test('rejects an added or removed field', () => {
  differ('model A {\n  id Int\n}', 'model A {\n  id Int\n  name String\n}');
});

test('rejects a field moved to another model', () => {
  differ(
    'model A {\n  id Int\n  x Int\n}\nmodel B {\n  id Int\n}',
    'model A {\n  id Int\n}\nmodel B {\n  id Int\n  x Int\n}',
  );
});

test('rejects a changed index definition', () => {
  differ(
    'model A {\n  a Int\n  b Int\n  @@index([a, b])\n}',
    'model A {\n  a Int\n  b Int\n  @@index([b, a])\n}',
  );
});

test('rejects optional vs required and list type changes', () => {
  differ('model A {\n  a Int\n}', 'model A {\n  a Int?\n}');
  differ('model A {\n  a Int\n}', 'model A {\n  a Int[]\n}');
});

test('keeps enum value order significant', () => {
  differ('enum S {\n  A\n  B\n}', 'enum S {\n  B\n  A\n}');
});

test('does not treat // inside a quoted URL as a comment', () => {
  differ(
    'datasource db {\n  provider = "postgresql"\n  url = "postgres://one"\n}',
    'datasource db {\n  provider = "postgresql"\n  url = "postgres://two"\n}',
  );
});

// If a generated client exists, the real schema must match its inlineSchema.
const backendDir = path.resolve(import.meta.dirname, '..');
const generatedIndex = path.join(backendDir, 'node_modules', '.prisma', 'client', 'index.js');
test('current schema.prisma matches the generated client inlineSchema', { skip: !existsSync(generatedIndex) }, () => {
  const match = readFileSync(generatedIndex, 'utf8').match(/"inlineSchema":\s*"((?:\\.|[^"\\])*)"/);
  assert.ok(match, 'generated client has an inlineSchema');
  same(readFileSync(path.join(backendDir, 'prisma', 'schema.prisma'), 'utf8'), JSON.parse(`"${match[1]}"`));
});
