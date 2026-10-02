#!/usr/bin/env node
/**
 * Postinstall hook for hosted deploys (Render).
 *
 * Render's default Node build is just `npm install` in the service's root
 * directory (backend/), which would leave the Prisma client ungenerated and
 * frontend/dist missing. Hanging that work off postinstall makes the deploy
 * work without any custom build command in the dashboard.
 *
 * No-ops outside Render unless RUN_DEPLOY_BUILD=1, so local `npm install`
 * stays fast. Migrations are NOT run here — they happen at boot in
 * `npm run start:prod`, because the database isn't reachable during build on
 * every plan.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const isHosted = process.env.RENDER === 'true' || process.env.RUN_DEPLOY_BUILD === '1';
if (!isHosted) {
  console.log('[build] Not a hosted deploy — skipping (set RUN_DEPLOY_BUILD=1 to force).');
  process.exit(0);
}

const backendDir = path.resolve(import.meta.dirname, '..');
const frontendDir = path.resolve(backendDir, '../frontend');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  console.log(`[build] ${cmd} ${args.join(' ')}  (cwd: ${cwd})`);
  // Node 20+ refuses to execFile a .cmd shim without a shell (CVE-2024-27980),
  // but a shell would also re-split an interpreter path containing spaces
  // (C:\Program Files\...), so scope it to the .cmd case only.
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: cmd.endsWith('.cmd') });
}

// 1. Prisma client — the app cannot import @prisma/client without this.
//    The gate checks the actual generated runtime metadata and only generates
//    when that client is missing or incompatible with this checkout.
run(process.execPath, [path.join(backendDir, 'scripts/ensure-prisma-client.js')], backendDir);

// The commit being deployed. Render exports it; elsewhere ask git. null when
// neither is available, which forces a rebuild.
function currentCommit() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backendDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

// 2. Frontend bundle, served by app.js at the same origin as the API.
//    Skipped only when dist/ was built from this exact commit (stamped in
//    dist/.build-commit), so an explicit buildCommand that builds the frontend
//    first doesn't pay twice — while a dist/ left over from an earlier deploy
//    or a build cache can no longer ship a stale UI.
const distDir = path.join(frontendDir, 'dist');
const stampFile = path.join(distDir, '.build-commit');
const commit = currentCommit();
const builtFrom = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : null;
if (!existsSync(path.join(frontendDir, 'package.json'))) {
  console.log('[build] No frontend/ directory — skipping SPA build.');
} else if (commit && builtFrom === commit && existsSync(path.join(distDir, 'index.html'))) {
  console.log(`[build] frontend/dist already built from ${commit.slice(0, 12)} — skipping.`);
} else {
  // --ignore-scripts: the frontend has no build hooks of its own, and this
  // stops a nested postinstall from recursing back into this script.
  run(npm, ['ci', '--include=dev', '--ignore-scripts'], frontendDir);
  run(npm, ['run', 'build'], frontendDir);
  if (commit) writeFileSync(stampFile, `${commit}\n`);
}

console.log('[build] Deploy build complete.');
