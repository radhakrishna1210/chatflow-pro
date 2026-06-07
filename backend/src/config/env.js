import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  CHATFLOW_PRO_URL: z.string().url().default('http://localhost:8080'),
  JSON_BODY_LIMIT: z.string().default('2mb'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  ADMIN_EMAIL: z.string().email(),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  ENCRYPTION_KEY: z.string().length(32),

  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_BUSINESS_ID: z.string().min(1),
  META_WABA_ID: z.string().min(1),
  META_SYSTEM_USER_ID: z.string().min(1),
  META_SYSTEM_USER_TOKEN: z.string().min(1),
  META_DISPLAY_NAME: z.string().min(1),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  META_API_VERSION: z.string().default('v21.0'),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),

  CAMPAIGN_BATCH_SIZE: z.coerce.number().default(50),
  CAMPAIGN_WORKER_CONCURRENCY: z.coerce.number().default(2),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // SMTP — optional until credentials are configured
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('ChatFlow Pro'),
  EMAIL_FROM: z.string().optional(),
  APP_URL: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const base = parsed.data;

export const env = {
  ...base,
  GOOGLE_CALLBACK_URL:
    base.GOOGLE_CALLBACK_URL ??
    `http://localhost:${base.PORT}/api/v1/auth/google/callback`,
};
