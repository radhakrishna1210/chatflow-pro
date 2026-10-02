// Worker-only entrypoint (`npm run start:worker`): the same boot as
// src/server.js — migrations, settings, backfill, BullMQ workers, schedules,
// recovery and sweeps — without the HTTP listener.
//
// Splitting is optional. `npm start` keeps running everything in one process;
// to split, run this as a second service with its own database pool and set
// RUN_WORKERS=false on the web service, so exactly one process owns the
// background work (see DEPLOY.md).
process.env.SERVE_HTTP = 'false';

await import('./server.js');
