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
import { existsSync } from 'node:fs';
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
  // Node 20+ refuses to execFile a .cmd shim without a shell (CVE-2024-27980).
  // Only needed for local Windows runs; the args here contain no shell metachars.
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: isWindows });
}

// 1. Prisma client — the app cannot import @prisma/client without this.
run(npm, ['exec', '--', 'prisma', 'generate'], backendDir);

// 2. Frontend bundle, served by app.js at the same origin as the API.
//    Skipped when dist/ is already present, so an explicit buildCommand that
//    builds the frontend first doesn't pay for it twice.
if (!existsSync(path.join(frontendDir, 'package.json'))) {
  console.log('[build] No frontend/ directory — skipping SPA build.');
} else if (existsSync(path.join(frontendDir, 'dist/index.html'))) {
  console.log('[build] frontend/dist already built — skipping.');
} else {
  // --ignore-scripts: the frontend has no build hooks of its own, and this
  // stops a nested postinstall from recursing back into this script.
  run(npm, ['ci', '--include=dev', '--ignore-scripts'], frontendDir);
  run(npm, ['run', 'build'], frontendDir);
}

console.log('[build] Deploy build complete.');
