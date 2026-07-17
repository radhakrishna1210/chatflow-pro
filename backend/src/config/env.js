import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  // Extra allowed CORS origins (comma-separated), e.g. a preview deployment.
  CORS_EXTRA_ORIGINS: z.string().optional(),
  JSON_BODY_LIMIT: z.string().default('2mb'),

  DATABASE_URL: z.string().min(1),
  // Direct (non-pooled) connection for Prisma migrations. Falls back to
  // DATABASE_URL so local setups keep working without extra config.
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  ADMIN_EMAIL: z.string().email(),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  // 32 ASCII chars or 64 hex chars — validated in lib/encryption.js
  ENCRYPTION_KEY: z.string().min(32),

  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_BUSINESS_ID: z.string().min(1),
  META_WABA_ID: z.string().min(1),
  META_SYSTEM_USER_ID: z.string().min(1),
  META_SYSTEM_USER_TOKEN: z.string().min(1),
  META_DISPLAY_NAME: z.string().min(1),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  META_API_VERSION: z.string().default('v21.0'),
  // Must exactly match the redirect_uri configured in the Meta App dashboard
  // for Embedded Signup. Defaults to the backend callback route.
  META_REDIRECT_URI: z.string().url().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),

  CAMPAIGN_BATCH_SIZE: z.coerce.number().default(50),
  CAMPAIGN_WORKER_CONCURRENCY: z.coerce.number().default(2),
  // Meta Cloud API Tier-1 numbers allow ~250 msgs/min → 1 msg / 250ms is safe.
  CAMPAIGN_RATE_DELAY_MS: z.coerce.number().default(250),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('phi3'),

  // Razorpay test/live keys — optional until subscription checkout is configured.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

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

// Prisma reads DIRECT_URL from process.env directly — provide the fallback there too.
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = base.DATABASE_URL;

const backendBase = base.APP_URL ?? `http://localhost:${base.PORT}`;

export const env = {
  ...base,
  DIRECT_URL: base.DIRECT_URL ?? base.DATABASE_URL,
  GOOGLE_CALLBACK_URL:
    base.GOOGLE_CALLBACK_URL ?? `${backendBase}/api/v1/auth/google/callback`,
  META_REDIRECT_URI:
    base.META_REDIRECT_URI ?? `${backendBase}/api/v1/auth/meta/callback`,
  CORS_ORIGINS: [
    base.CLIENT_URL,
    ...(base.CORS_EXTRA_ORIGINS ? base.CORS_EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ],
};
