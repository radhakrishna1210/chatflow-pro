#!/usr/bin/env node
/**
 * Verifies the Prisma Client actually in node_modules before application code
 * can import it. Prisma embeds its input schema and generated client version
 * in .prisma/client/index.js, so this remains correct after direct generation.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const backendDir = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(backendDir, 'prisma', 'schema.prisma');
const generatedClientDir = path.join(backendDir, 'node_modules', '.prisma', 'client');
const generatedIndexPath = path.join(generatedClientDir, 'index.js');
const windowsEnginePath = path.join(generatedClientDir, 'query_engine-windows.dll.node');
const installedWindowsEnginePath = path.join(backendDir, 'node_modules', '@prisma', 'engines', 'query_engine-windows.dll.node');
const lockDir = path.join(backendDir, 'node_modules', '.prisma', '.chatflow-prisma-generate.lock');
const lockInfoPath = path.join(lockDir, 'owner.json');
const LOCK_WAIT_MS = 60_000;
const STALE_LOCK_MS = 5 * 60_000;
const require = createRequire(import.meta.url);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Prisma formats schema.prisma while generating its embedded inlineSchema.
// Compare the schema language rather than formatting/comments, while retaining
// all quoted text (defaults, native types, relation names, and URLs).
function canonicalSchema(text) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let result = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      result += char;
      if (char === '\\') result += source[++index] || '';
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; result += char; continue; }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      if (index === -1) break;
      index += 1;
      continue;
    }
    if (!/\s/.test(char)) result += char;
  }
  return result;
}

function windowsEngineTemps() {
  if (process.platform !== 'win32' || !existsSync(generatedClientDir)) return [];
  return readdirSync(generatedClientDir).filter((file) => /query_engine-windows\.dll\.node\.tmp/i.test(file));
}

function filesMatch(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false;
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  return digest(left) === digest(right);
}

function dependencyVersions() {
  try {
    const prisma = require('prisma/package.json').version;
    const client = require('@prisma/client/package.json').version;
    return prisma === client
      ? { prisma, client }
      : { error: `Installed prisma (${prisma}) and @prisma/client (${client}) versions differ.` };
  } catch {
    return { error: 'Prisma dependencies are missing. Run npm install (or npm ci) in backend.' };
  }
}

function generatedMetadata() {
  if (!existsSync(generatedIndexPath)) return { error: 'Generated Prisma Client is missing.' };
  try {
    const source = readFileSync(generatedIndexPath, 'utf8');
    const schemaMatch = source.match(/"inlineSchema":\s*"((?:\\.|[^"\\])*)"/);
    const versionMatch = source.match(/Prisma\.prismaVersion\s*=\s*\{\s*client:\s*"([^"]+)"/);
    if (!schemaMatch || !versionMatch) return { error: 'Generated Prisma Client metadata is incomplete.' };
    return { schema: JSON.parse(`"${schemaMatch[1]}"`), clientVersion: versionMatch[1] };
  } catch {
    return { error: 'Generated Prisma Client metadata cannot be read.' };
  }
}

async function validateClient() {
  const versions = dependencyVersions();
  if (versions.error) return versions;

  let expectedSchema;
  try { expectedSchema = canonicalSchema(readFileSync(schemaPath, 'utf8')); }
  catch { return { error: 'Current prisma/schema.prisma cannot be read.' }; }

  const generated = generatedMetadata();
  if (generated.error) return generated;
  if (canonicalSchema(generated.schema) !== expectedSchema) {
    return { error: 'Generated Prisma Client schema is stale or belongs to another checkout.' };
  }
  if (generated.clientVersion !== versions.client) {
    return { error: `Generated Prisma Client version (${generated.clientVersion}) does not match installed @prisma/client (${versions.client}).` };
  }

  try {
    const { getBinaryTargetForCurrentPlatform, getNodeAPIName } = require('@prisma/get-platform');
    const binaryTarget = await getBinaryTargetForCurrentPlatform();
    const engineName = getNodeAPIName(binaryTarget, 'fs');
    const generatedEngine = path.join(generatedClientDir, engineName);
    const installedEngine = path.join(backendDir, 'node_modules', '@prisma', 'engines', engineName);
    if (!filesMatch(generatedEngine, installedEngine)) {
      return { error: `Generated Prisma native engine is missing or does not match the installed ${binaryTarget} engine.` };
    }
  } catch (error) {
    return { error: `Generated Prisma native engine cannot be validated: ${error.message}` };
  }

  try {
    const { PrismaClient, Prisma } = await import('@prisma/client');
    if (Prisma?.prismaVersion?.client !== versions.client) {
      return { error: 'Runtime Prisma Client version does not match the installed package.' };
    }
    const prisma = new PrismaClient();
    const delegate = prisma.authenticationConfig;
    const validDelegate = delegate && typeof delegate.findUnique === 'function';
    await prisma.$disconnect();
    return validDelegate ? { valid: true } : { error: 'Generated Prisma Client is missing authenticationConfig.findUnique.' };
  } catch (error) {
    return { error: `Generated Prisma Client cannot be loaded: ${error.message}` };
  }
}

function lockOwnerIsRunning() {
  try {
    const { pid } = JSON.parse(readFileSync(lockInfoPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM'; // Existing process owned by another user.
  }
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir, { recursive: false });
      writeFileSync(lockInfoPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = (() => { try { return Date.now() - statSync(lockDir).mtimeMs; } catch { return 0; } })();
      if (age > STALE_LOCK_MS && !lockOwnerIsRunning()) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      await sleep(250);
    }
  }
  throw new Error('Timed out waiting for another process to finish Prisma Client generation.');
}

function generationFailure(error, windowsEngineLocked) {
  return windowsEngineLocked
    ? 'Prisma could not replace query_engine-windows.dll.node because another process is locking it. Stop that backend process, then start again.'
    : `Prisma generation failed: ${error.message}`;
}

async function main() {
  const initial = await validateClient();
  if (initial.valid) {
    console.log('[prisma] Generated client matches the current schema and runtime API.');
    return;
  }

  console.log(`[prisma] ${initial.error} Regenerating before startup...`);
  let releaseLock;
  let windowsEngineLocked = false;
  try {
    releaseLock = await acquireLock();
    const afterLock = await validateClient();
    if (afterLock.valid) return; // Another process completed generation first.

    const engineTempsBefore = new Set(windowsEngineTemps());
    try {
      execFileSync(process.execPath, [path.join(backendDir, 'scripts', 'prisma-cli.js'), 'generate'], {
        cwd: backendDir,
        stdio: 'inherit',
      });
    } catch (error) {
      windowsEngineLocked = windowsEngineTemps().some((file) => !engineTempsBefore.has(file));
      if (!windowsEngineLocked || !filesMatch(windowsEnginePath, installedWindowsEnginePath)) throw error;

      // Windows cannot replace a loaded DLL. Prisma has already written the
      // generated JavaScript at this point; it is safe to retain the loaded
      // native engine only when it is byte-identical to the engine this Prisma
      // installation would have copied. The complete runtime validation below
      // remains the authority for whether startup may continue.
      console.warn('[prisma] Windows kept an already-current query engine DLL that another process has loaded.');
    }

    const regenerated = await validateClient();
    if (!regenerated.valid) throw new Error(`Generated client remains incompatible: ${regenerated.error}`);
    if (windowsEngineLocked && !filesMatch(windowsEnginePath, installedWindowsEnginePath)) {
      throw new Error('The locked Windows query engine does not match the installed Prisma engine.');
    }
    console.log('[prisma] Generated client is ready.');
  } catch (error) {
    console.error(`[prisma] ${generationFailure(error, windowsEngineLocked)}`);
    console.error('[prisma] Server startup stopped; an incompatible Prisma Client will not be used.');
    process.exitCode = 1;
  } finally {
    releaseLock?.();
  }
}

await main();
