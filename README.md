# ChatFlow Pro

A full-stack WhatsApp Business messaging platform for managing conversations, campaigns, contacts, and automation — built with Node.js (Express) on the backend and React (Vite) on the frontend.

## Features

- **WhatsApp Integration** — Send and receive messages via the Meta (WhatsApp Business) API with webhook signature verification
- **Conversations** — Unified inbox for managing customer conversations across workspaces
- **Campaigns** — Bulk message campaigns with a BullMQ/Redis queue worker
- **Contacts** — Contact management with CSV import support
- **Templates** — WhatsApp message template management
- **Automation** — Rule-based automated responses and workflows
- **Analytics** — Workspace-level messaging analytics
- **Team Members** — Multi-user workspace support with role management
- **API Keys** — Programmatic access via API key authentication
- **Auth** — JWT-based auth with Google OAuth 2.0 (Passport.js)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express 5, Prisma ORM, PostgreSQL |
| Queue | BullMQ + Redis (ioredis) |
| Auth | JWT, bcryptjs, Passport.js + Google OAuth 2.0 |
| Validation | Zod |
| Frontend | React 18, Vite 5 |
| Messaging | Meta WhatsApp Business API, Twilio |

## Project Structure

```
chatflow-pro/
├── backend/
│   └── src/
│       ├── config/          # Environment config
│       ├── controllers/     # Route handlers
│       ├── lib/             # Prisma & Redis clients
│       ├── middleware/      # Auth, error handling, workspace context
│       ├── queues/          # BullMQ campaign queue
│       ├── routes/          # Express routers
│       ├── services/        # Business logic
│       ├── workers/         # BullMQ campaign worker
│       └── server.js        # Entry point
├── frontend/                # React + Vite app
├── components/              # Shared UI components (auth, dashboard, landing)
├── screenshots/             # App screenshots
└── ChatFlow Pro.html        # Standalone demo page
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis

### Backend Setup

```bash
cd backend
cp .env.example .env   # fill in your values
npm install
npm run db:generate    # generate Prisma client
npm run db:migrate     # run migrations
npm run dev            # start with hot-reload
```

Required environment variables:

```
DATABASE_URL=postgresql://user:password@localhost:5432/chatflowpro
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret
META_APP_SECRET=your_meta_app_secret
META_WEBHOOK_VERIFY_TOKEN=your_verify_token
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
PORT=3000
NODE_ENV=development
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev   # starts Vite dev server at http://localhost:5173
```

## API Overview

All workspace-scoped routes are prefixed with `/api/workspaces/:workspaceId`.

| Route | Description |
|-------|-------------|
| `GET /api/health` | Health check |
| `POST /api/auth/*` | Authentication (login, register, Google OAuth) |
| `GET/POST /api/webhook/meta` | Meta webhook verify & receive |
| `/api/workspaces/:id/whatsapp` | WhatsApp message sending |
| `/api/workspaces/:id/templates` | Message templates |
| `/api/workspaces/:id/campaigns` | Campaign management |
| `/api/workspaces/:id/contacts` | Contact CRUD + CSV import |
| `/api/workspaces/:id/conversations` | Conversation inbox |
| `/api/workspaces/:id/analytics` | Analytics data |
| `/api/workspaces/:id/automation` | Automation rules |
| `/api/workspaces/:id/settings` | Workspace settings |
| `/api/workspaces/:id/members` | Team member management |
| `/api/workspaces/:id/api-keys` | API key management |

## License

MIT
