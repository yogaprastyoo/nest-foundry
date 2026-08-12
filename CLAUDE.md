# nest-foundry

> File ini juga tersedia sebagai `AGENTS.md` untuk tool selain Claude Code. Kalau menambah aturan baru, tambahkan di SALAH SATU file lalu jalankan sinkronisasi manual — `CLAUDE.md` tetap sumber kebenaran untuk Claude Code.

NestJS 11 + TypeScript REST API starter.

## Commands

```bash
npm run start:dev          # dev server (hot-reload)
npm run start:prod         # production (node dist/main)
npm run build              # tsc compile check
npm run lint               # eslint --fix
npm run test               # unit tests
npm run test:e2e           # e2e tests (--runInBand, jangan paralel)
npm run test:cov           # coverage report
npm run prisma:migrate     # prisma migrate dev (dev only)
npm run prisma:deploy      # prisma migrate deploy (production)
npm run prisma:studio      # prisma studio GUI
npm run db:seed            # seed admin user via tsx prisma/seed.ts
```

Reset DB (dev only — butuh consent env var):
```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="I want to reset the database" npx prisma migrate reset
```

## URL & Endpoints

- Base: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs` (non-production only)
- Health: `GET /api/v1/health`
- Auth: `POST /api/v1/auth/{register,login,refresh,logout,verify-email,resend-verification}`
- Users: `GET /api/v1/users/me`

## Aturan Wajib

- Semua string user-facing (API/validation/error/Swagger/email) **harus bahasa Inggris**
- Jangan pernah append `Co-Authored-By: Claude` di commit/PR
- Commit subject ≤72 karakter, conventional commits
- Jalankan `npm run lint && npx tsc --noEmit && npm run test` sebelum commit
- Jalankan app dengan `nest start` (tsc), **bukan** `tsx` — tsx skip `emitDecoratorMetadata` → DI rusak
- `tsx` hanya boleh untuk script CLI: `prisma/seed.ts`

## Response Envelope (wajib semua endpoint)

```json
// Sukses
{ "success": true, "message": "...", "data": {...} }
// Error
{ "success": false, "message": "...", "errors": null }
// Validation 400
{ "success": false, "message": "The given data was invalid.", "errors": { "email": "..." } }
```

Controller return raw data + `@ResponseMessage('...')`. Jangan wrap manual.

## Konvensi Kode

- `import type` untuk interface-only imports (isolatedModules + emitDecoratorMetadata)
- Untuk third-party types: `import * as express from 'express'` (bukan `import type`)
- `NormalizeEmail()` decorator di setiap email DTO field (trim + lowercase)
- `ValidationMessage` helper untuk semua pesan validasi — `src/common/validation/validation-message.ts`
- `CONSTRAINT_PRIORITY` enforces required > type > format > size (Laravel-style)
- Prisma error: duck-type via `error.code` bukan `instanceof PrismaClientKnownRequestError` (ESM generated client)
- P2002 → 409, P2025 → 404 sudah di-handle di `AllExceptionsFilter`
- `resolveAvatarUrl(user)` — derived at read-time, tidak disimpan; fallback ke ui-avatars.com

## Testing

- Unit spec: `jest.mock('../../prisma/prisma.service')` **wajib di baris pertama** di semua spec yang pull PrismaService
- Import `TokenType` dari `src/generated/prisma/enums` (bukan barrel `client.ts` — barrel break Jest)
- E2e env toggle harus via side-effect import **sebelum** AppModule load: `test/helpers/disable-email-verification.ts`
- Reset state antar e2e test: `throttlerStorage.storage.clear()` + `redis.flushdb()` (keduanya, bukan salah satu)
- Fixture domain: `user@example.test` (RFC 6761), bukan `example.com`
- E2e `--runInBand` wajib (shared DB, parallel workers kolisi)

## Keamanan (jangan diubah tanpa alasan kuat)

- Token: CSPRNG 256-bit, stored as SHA-256, single-active per type per user
- Atomic single-use via `$transaction` + `deleteMany count === 1` (TOCTOU-safe)
- Anti-enumeration: resend cooldown di-set untuk semua email (ada atau tidak di DB)
- Resend quota 5/jam per email — silent uniform 200 (jangan ubah ke 429)
- Brute-force lockout: 10 gagal login → lock 15 menit (Redis key `auth:lockout:{email}`)
- Anti timing-enumeration: email tidak ditemukan → tetap jalankan argon2 verify dummy hash
- JWT: algoritma pin HS256, validasi `iss`/`aud`, secret access ≠ refresh (min 32 char)
- Refresh token reuse → revoke SEMUA session user (bukan hanya tolak request)
- pino redaction: `authorization`, `cookie`, `set-cookie` header tidak pernah masuk log

## Prisma Mock (untuk unit test)

`src/prisma/__mocks__/prisma.service.ts` — extend jika menambah model baru:
```typescript
// Model baru tambahkan di sini, bukan di test file langsung
refreshToken = { findUnique: jest.fn(), ... }
$transaction = jest.fn((fn) => fn(this))
```

## Progress Plan

**Wajib:** perbarui bagian ini di commit yang SAMA dengan commit yang menyelesaikan
fitur/plan terkait. Jangan tunda ke commit terpisah — Progress Plan yang basi
menyesatkan setiap sesi berikutnya yang membaca file ini.

- ✅ Plan 1: Foundation (Prisma, Redis, BullMQ, config, logging, throttle, health, envelope)
- ✅ Plan 2: Auth Core (register, login, refresh, logout, JWT, cookie, lockout, /users/me)
- ✅ Plan 3: Email Verification (token, queue, template, resend cooldown+quota)
- ✅ Plan 4: Google OAuth (login, reauth, set-password, unlink-google) — spec bagian D
- ✅ Plan 5: Docker + CI — spec bagian H
- ✅ Docs operasional lengkap (getting-started, architecture, conventions, api-reference, recipes/) — spec bagian F

## Infrastruktur (dev)

- PostgreSQL & Redis di VPS internal, akses via VPN
- Config lengkap di `.env` (gitignored) — lihat `.env.example` untuk semua variabel
- `docker/docker-compose.yml` tersedia untuk dev lokal (postgres + redis tanpa VPS)
- Runtime Node dipin di `.nvmrc` + `engines` (`package.json`). Kebijakan: ikuti
  **Active LTS** saat ini, bukan angka versi permanen — saat LTS berganti, update
  keduanya bersamaan, jangan biarkan drift.
