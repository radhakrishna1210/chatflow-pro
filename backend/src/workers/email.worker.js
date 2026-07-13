import { Worker } from 'bullmq';
import { createBullConnection } from '../lib/redis.js';
import { sendMail } from '../lib/mailer.js';
import { buildEmailHtml } from '../services/email.service.js';

async function processEmail(job) {
  const { type, to, payload } = job.data;
  const { subject, html } = buildEmailHtml(type, payload);
  await sendMail({ to, subject, html });
}

export function startEmailWorker() {
  const worker = new Worker('emails', processEmail, {
    connection: createBullConnection('email-worker'),
    concurrency: 5,
  });

  worker.on('completed', (job) => console.log(`[EmailWorker] Job ${job.id} (${job.data.type}) sent to ${job.data.to}`));
  worker.on('failed', (job, err) => console.error(`[EmailWorker] Job ${job?.id} failed:`, err.message));

  return worker;
}
