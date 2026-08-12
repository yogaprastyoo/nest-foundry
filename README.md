# Nest Foundry

NestJS 11 + TypeScript REST API starter with Prisma, Redis, and BullMQ.

## Features & Tech Stack

- **Framework:** NestJS 11
- **Database & ORM:** PostgreSQL 16 + Prisma 7
- **In-Memory & Cache:** Redis 7 (Throttler Rate Limiting & Auth Lockout)
- **Queue System:** BullMQ (Email verification & transactional mail via Resend)
- **Security:** CSPRNG 256-bit tokens, argon2 password hashing, HS256 JWT rotation, anti-enumeration dummy hashing
- **Authentication:** Local auth (email/password) + Google OAuth 2.0 (login, reauth, unlink)

## Prerequisites

- Node.js 24 (see `.nvmrc` and `package.json` engines)
- Docker & Docker Compose (for local database & Redis infrastructure)

## Getting Started

### 1. Environment Setup

Copy example environment variables:

```bash
cp .env.example .env
```

### 2. Local Infrastructure (Docker Compose)

Start local PostgreSQL and Redis services:

```bash
docker compose -f docker/docker-compose.yml up -d
```

### 3. Database Migration & Seed

Run database migrations and seed admin credentials:

```bash
npm run prisma:migrate
npm run db:seed
```

### 4. Run Development Server

```bash
npm run start:dev
```

- Base API: `http://localhost:3000/api/v1`
- Swagger Documentation: `http://localhost:3000/docs`

## Production Deployment with Docker

Build and run full application stack (App + Postgres + Redis):

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

## Available Scripts

- `npm run build` - Compile TypeScript app
- `npm run start:dev` - Run development server with hot-reload
- `npm run start:prod` - Run compiled production app
- `npm run lint` - Run ESLint checks and fixes
- `npm run test` - Run Jest unit tests
- `npm run test:e2e` - Run Jest end-to-end tests
- `npm run prisma:migrate` - Run Prisma development migrations
- `npm run prisma:deploy` - Apply Prisma production migrations
- `npm run db:seed` - Seed database with initial data
