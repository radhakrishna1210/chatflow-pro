import './config/env.js';
import app from './app.js';
import { env } from './config/env.js';
import { startCampaignWorker } from './workers/campaign.worker.js';
import { prisma } from './lib/prisma.js';

async function main() {
  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }

  startCampaignWorker();
  console.log('[Worker] Campaign worker started');

  app.listen(env.PORT, () => {
    console.log(`[Server] ChatFlow Pro backend running on port ${env.PORT}`);
    console.log(`[Server] Environment: ${env.NODE_ENV}`);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
