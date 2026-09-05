import 'dotenv/config';
import { z } from 'zod';
import { getSystemSetting } from './settingsStore.js';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  // Extra allowed CORS origins (comma-separated), e.g. a preview deployment.
  CORS_EXTRA_ORIGINS: z.string().optional(),
  JSON_BODY_LIMIT: z.string().default('2mb'),
  // Number of reverse-proxy hops in front of this service that are ours, and
  // whose X-Forwarded-For entries may therefore be believed. Express uses it to
  // derive req.ip, which every rate limit is keyed on. 0 (no proxy) is the safe
  // default: trusting a hop that does not exist lets any client claim any IP.
  // Render and most PaaS front the app with exactly one proxy — set 1 there.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

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
  // Meta Embedded Signup "configuration ID", created in the App Dashboard
  // under WhatsApp > Embedded Signup. Without this, the frontend can't use
  // FB.login's Embedded Signup flow and silently falls back to the legacy
  // dialog/oauth flow, which throws Meta's "App not active" error for
  // Development-mode apps requesting advanced WhatsApp permissions.
  META_ES_CONFIG_ID: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),

  // Public origin of THIS backend. Twilio signs its webhooks over the exact URL
  // it called, and the Instagram OAuth redirect_uri must match byte-for-byte,
  // so neither can be derived from CLIENT_URL when the two are deployed apart.
  // Defaults to APP_URL (the existing backend-base convention, see below) so no
  // new configuration is needed for the single-service Render deploy.
  API_PUBLIC_URL: z.string().url().optional(),

  // Instagram Quickflows. Falls back to the Meta app credentials above when a
  // dedicated IG app isn't used; the feature stays off until one is present.
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: z.string().url().optional(),

  // BullMQ idle-polling tuning. Every blocking poll and stalled-job check is a
  // billed request on a hosted Redis (Upstash), and three workers poll around
  // the clock whether or not any job exists — the defaults below are ~10x
  // cheaper than BullMQ's (5s / 30s) while costing nothing in pickup latency:
  // a waiting worker is still woken immediately when a job is pushed.
  WORKER_DRAIN_DELAY_SEC: z.coerce.number().default(60),
  // Trade-off: this is how long a job orphaned by a crashed worker waits before
  // another worker reclaims it. Lower it if faster recovery matters more than
  // request volume.
  WORKER_STALLED_INTERVAL_MS: z.coerce.number().default(300_000),

  CAMPAIGN_BATCH_SIZE: z.coerce.number().default(50),
  CAMPAIGN_WORKER_CONCURRENCY: z.coerce.number().default(2),
  // Meta Cloud API Tier-1 numbers allow ~250 msgs/min → 1 msg / 250ms is safe.
  CAMPAIGN_RATE_DELAY_MS: z.coerce.number().default(250),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // Pinned model ids get retired — `gemini-2.5-flash` started rejecting new
  // API keys with a 404 ("no longer available to new users"), which silently
  // broke every AI feature. The `-latest` alias tracks the current Flash model
  // instead; override this only to pin a specific version deliberately.
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  // Where a request goes when GEMINI_MODEL answers 503 "experiencing high
  // demand" — which the flash tier does often enough to look like an outage
  // (measured at ~2 calls in 5). The lite model runs on separate capacity and
  // answered every call in the same test, so it is the safety net rather than
  // the default: it is cheaper and weaker, and only used when the first choice
  // has already been retried and is still busy. See lib/llm.js#callGemini.
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-flash-lite-latest'),
  // Embedding model for the website assistant's knowledge index
  // (lib/embeddings.js). A separate family from the text models above and
  // billed separately; it is on the free tier, unlike image generation.
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  // gemini-embedding-001 returns 3072 dimensions by default. The corpus is
  // ~100 short chunks, where 768 retrieves indistinguishably well for a
  // quarter of the storage and scan cost. Changing this invalidates every
  // stored vector — vectors of different widths cannot be compared — so the
  // indexer re-embeds the whole corpus when it sees the width change.
  GEMINI_EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  // Image generation is a separate family of models and, unlike text, is not
  // offered on the Gemini free tier at all — a free key reports
  // "limit: 0" for it, so header generation needs billing enabled on the key.
  GEMINI_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),
  // Header images are generated by OpenAI when this is set, because Gemini's
  // image models are not on its free tier at all (see above). Gemini remains
  // the fallback, so removing this key restores the previous behaviour.
  OPENAI_API_KEY: z.string().optional(),
  // `gpt-image-1` requires a verified OpenAI organisation. If verification is
  // the blocker, `dall-e-3` needs no verification and is handled here too.
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  // 'low' | 'medium' | 'high' on gpt-image-1; 'standard' | 'hd' on dall-e-3.
  // Medium is the cost/quality balance that suits a small WhatsApp header.
  OPENAI_IMAGE_QUALITY: z.string().default('medium'),
  // Cloudflare Workers AI is the free leg of the image chain: OpenAI and
  // Gemini both bill per image with no free allowance, so without this a
  // workspace with no credit gets no picture at all. Free daily allowance,
  // account + token only, no card.
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  // flux-1-schnell is fast and returns base64 JSON; the SDXL models return raw
  // bytes instead. Both are handled — the image type is sniffed, not assumed.
  CLOUDFLARE_IMAGE_MODEL: z.string().default('@cf/black-forest-labs/flux-1-schnell'),
  // 'auto' tries each configured provider in order and falls through when one
  // is billing-blocked or unreachable. Naming a provider pins it, which is what
  // you want when diagnosing which one is actually failing.
  IMAGE_PROVIDER: z.enum(['auto', 'openai', 'cloudflare', 'gemini']).default('auto'),
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
  // Node resolves smtp.gmail.com to IPv6 first, and a host with no IPv6 route
  // fails every send with `connect ENETUNREACH 2607:f8b0:...:587` before the
  // login is even attempted. Pinning to IPv4 is the fix; set this to 6 on an
  // IPv6-only host, or 0 to let Node choose.
  SMTP_IP_FAMILY: z.coerce.number().default(4),
  EMAIL_FROM_NAME: z.string().default('Spandan'),
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

// Every OAuth callback and provider webhook must point at the host that
// actually serves /api/v1 — which is not always APP_URL. APP_URL doubles as the
// public app origin baked into the website-widget install snippet, so it gets
// pointed at the deployed service even while the API is running locally. When
// that happens the callbacks have to follow the API, not the widget, or the
// provider hands back a redirect_uri the app never registered
// (Google answers that with `Error 400: redirect_uri_mismatch`).
//
// API_PUBLIC_URL is that single base: set it once and Google, Meta and
// Instagram all stay in agreement instead of drifting apart one env var at a
// time.
const apiBase = base.API_PUBLIC_URL ?? backendBase;

// The environment as the app reads it, with database overrides layered on top.
//
// A platform credential (an API key, an SMTP password) can be changed from the
// super-admin screen and takes effect on the next property read — no redeploy,
// which on the hosted plan means minutes of downtime for a one-line change.
// Everything else still comes from the process environment, and only the names
// in settingsStore.js can be overridden at all.
//
// Reading through a Proxy rather than snapshotting is what makes this work:
// modules capture `env` once at import time, so a static object would freeze
// whatever was configured at boot.
const baseEnv = {

  ...base,
  DIRECT_URL: base.DIRECT_URL ?? base.DATABASE_URL,
  // Twilio validates its signature against the exact URL it called, and the
  // Instagram redirect_uri must match the app config byte-for-byte — both
  // resolve off the same API base as the OAuth callbacks below.
  API_PUBLIC_URL: apiBase,
  GOOGLE_CALLBACK_URL:
    base.GOOGLE_CALLBACK_URL ?? `${apiBase}/api/v1/auth/google/callback`,
  META_REDIRECT_URI:
    base.META_REDIRECT_URI ?? `${apiBase}/api/v1/auth/meta/callback`,
  INSTAGRAM_REDIRECT_URI:
    base.INSTAGRAM_REDIRECT_URI ?? `${apiBase}/api/v1/auth/instagram/callback`,
  CORS_ORIGINS: [
    base.CLIENT_URL,
    ...(base.CORS_EXTRA_ORIGINS ? base.CORS_EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ],
};

export const env = new Proxy(baseEnv, {
  get(target, prop, receiver) {
    const override = getSystemSetting(prop);
    return override === undefined ? Reflect.get(target, prop, receiver) : override;
  },
  // Keep `in`, Object.keys and spreads honest about what is actually there.
  has(target, prop) {
    return getSystemSetting(prop) !== undefined || Reflect.has(target, prop);
  },
});
