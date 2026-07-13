# ChatFlow Pro — Backend

Node.js + Express 5 + Prisma + BullMQ backend for the ChatFlow Pro WhatsApp Business SaaS platform.

## Quick Start

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Generate Prisma client
npm run db:generate

# 4. Run database migrations
npm run db:migrate

# 5. Start the dev server
npm run dev
```

## Requirements

- Node.js 20+
- PostgreSQL 14+
- Redis 6+

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Min 32-char JWT signing secret |
| `ENCRYPTION_KEY` | 64-char hex string (32 bytes) for AES-256 token encryption |
| `META_APP_SECRET` | Facebook app secret for webhook HMAC verification |
| `META_SYSTEM_USER_TOKEN` | Long-lived Meta system user token for admin operations |
| `GEMINI_API_KEY` | Optional Gemini API key for AI workflow generation |

AI workflow generation is available from the Automation > Workflows tab. Add this to your backend `.env` when you are ready to use Gemini:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

## API Base URL

All routes are prefixed: `/api/v1`

Workspace-scoped routes: `/api/v1/workspaces/:workspaceId/*`

## Architecture

```
src/
├── config/env.js          Zod-validated env vars
├── lib/
│   ├── prisma.js          Prisma client singleton
│   ├── redis.js           ioredis client
│   ├── encryption.js      AES-256-CBC encrypt/decrypt
│   └── meta.js            Meta Graph API helpers
├── middleware/
│   ├── authenticate.js    JWT Bearer verification
│   ├── authorize.js       Role-based access control
│   └── workspaceContext.js Workspace membership check
├── queues/campaign.queue.js  BullMQ queue definition
├── workers/campaign.worker.js BullMQ worker (sends campaign messages)
├── routes/                Express routers
├── controllers/           Request/response handlers
└── services/              Business logic (no Express dependencies)
```

## Generating a valid ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
