# Getting Started Guide

This guide walks through local environment setup, configuration, database initialization, running application servers, and executing test suites for `loopwork-backend`.

## 1. Prerequisites & Version Pinning

Ensure the target machine has the exact runtime versions installed:

| Component | Minimum / Target Version | Verification Command | Location Reference |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v24.x` (Active LTS per ADR G-01) | `node -v` | `.nvmrc:1` / `package.json:9` |
| **npm** | `>=10.x` | `npm -v` | `package.json:13` |
| **Docker & Compose** | Docker v24+, Compose v2+ | `docker compose version` | `docker/docker-compose.yml:1` |

---

## 2. Environment Configuration

1. Copy the template environment configuration file to `.env`:

```bash
cp .env.example .env
```

2. Key required environment variables in `.env`:

| Variable Name | Default / Example Value | Description | Location Anchor |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/loopwork` | PostgreSQL connection string | `src/config/env.validation.ts:15` |
| `REDIS_HOST` | `localhost` | Redis server hostname | `src/config/env.validation.ts:25` |
| `REDIS_PORT` | `6379` | Redis server port | `src/config/env.validation.ts:26` |
| `JWT_ACCESS_SECRET` | `min-32-char-random-string-access-key` | Secret key for access JWTs | `src/config/env.validation.ts:35` |
| `JWT_REFRESH_SECRET` | `min-32-char-random-string-refresh-key` | Secret key for refresh JWTs | `src/config/env.validation.ts:36` |

---

## 3. Infrastructure Infrastructure Setup (Docker Compose)

Start local PostgreSQL and Redis containers using the provided Compose configuration:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Verify that both services are healthy:

```bash
docker compose -f docker/docker-compose.yml ps
```

---

## 4. Database Setup & Migration

Run database migrations to generate database tables and create the local Prisma client (`src/generated/prisma/`):

```bash
# 1. Run migrations in dev mode
npm run prisma:migrate

# 2. Seed initial admin account
npm run db:seed
```

---

## 5. Running the Application

### Development Mode (Hot-Reload)

```bash
npm run start:dev
```
Application starts at `http://localhost:3000/api/v1`.  
Swagger documentation is available at `http://localhost:3000/docs` (`src/main.ts:25`).

### Production Mode Compilation & Execution

```bash
# Build TypeScript output to dist/
npm run build

# Start compiled NestJS app
npm run start:prod
```

---

## 6. Execution Verification & Testing Suite

Before pushing any changes, verify all test suites and static checks pass cleanly:

```bash
# 1. Lint check and auto-fix
npm run lint

# 2. Strict TypeScript compile check
npx tsc --noEmit

# 3. Unit test suite
npm run test

# 4. End-to-end (E2E) test suite (Requires Postgres + Redis running, runs --runInBand)
npm run test:e2e
```
