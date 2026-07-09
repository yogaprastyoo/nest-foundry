# NestJS REST API Starter — Design Spec

**Tanggal:** 2026-07-09
**Status:** Disetujui user, siap masuk tahap implementation plan

## Tujuan

Starter project REST API berbasis NestJS yang "solid seperti Laravel": struktur pasti dan modular per fitur, pakai library populer yang terawat (tidak build sendiri), quality code terjaga, dan fitur bisa di-toggle (contoh: verifikasi email on/off) tanpa restrukturisasi.

## A. Tech Stack

| Kebutuhan | Pilihan |
|---|---|
| Framework | NestJS 11 + TypeScript (sudah ada dari `nest new`) |
| Database/ORM | PostgreSQL + Prisma 7 (client TypeScript murni, ESM; output generator di dalam `src/` agar terbaca build NestJS, integrasi via `PrismaService` + lifecycle hooks) |
| Queue | BullMQ + Redis |
| Email | Resend |
| Auth | Passport (local + JWT + Google OAuth), argon2 untuk hashing |
| Config | `@nestjs/config` + validasi env dengan Zod |
| Logging | `nestjs-pino` (structured JSON di prod, pretty di dev) |
| Security | Helmet, CORS via env, `@nestjs/throttler` |
| Docs API | `@nestjs/swagger` di `/docs` (non-production saja) |
| Health | `@nestjs/terminus` di `/health` (cek DB + Redis) |
| Testing | Jest (unit + e2e, supertest) |
| Container | Docker multi-stage + docker-compose |
| CI | GitHub Actions |
| Package manager | npm |

## B. Struktur Folder (Modular per Domain)

```
src/
  common/
    filters/            # global exception filter
    interceptors/       # response envelope interceptor
    decorators/         # @CurrentUser(), @Roles(), @ResponseMessage()
    guards/             # JwtAuthGuard, RolesGuard
    dto/                # shared DTO (pagination query, dst)
  config/
    env.validation.ts   # Zod schema, fail-fast saat env salah
    configuration.ts    # typed config
  modules/
    auth/
      strategies/       # local, jwt, google
      dto/
      auth.controller.ts / auth.service.ts / auth.module.ts
    users/
    mail/               # MailService (Resend) + templates/
    queue/              # QueueModule + processors/ (email.processor.ts)
  prisma/
    prisma.service.ts / prisma.module.ts
  main.ts
  app.module.ts
prisma/
  schema.prisma / migrations/ / seed.ts
test/
  auth.e2e-spec.ts
docker/
  Dockerfile / docker-compose.yml / docker-compose.prod.yml
.github/workflows/ci.yml
docs/                   # lihat bagian F
CLAUDE.md
```

Tiap module self-contained (controller, service, dto, module). Module baru ditambah di `modules/` tanpa menyentuh yang lain.

## C. Response Envelope (Standar Wajib)

Mengikuti skill `api-response`. Semua endpoint tanpa kecuali:

- Sukses: `{ "success": true, "message": "...", "data": {...|null} }`
- Error: `{ "success": false, "message": "...", "errors": null }`
- Validation error (400): `errors` berisi per-field message `{ "email": "Format email tidak valid." }`
- List: `data: { items: [], pagination: { page, per_page, total, total_pages } }`

Implementasi: interceptor global untuk sukses (message via decorator `@ResponseMessage()`), exception filter global untuk error, `ValidationPipe` global (whitelist + transform) dengan exception factory custom agar format `errors` sesuai.

HTTP status codes: 201 create, 200 sukses lain, 400 validasi, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict, 422 business rule, 429 rate limit, 500 server error.

### Penanganan Error Prisma & Transaksi (WAJIB, mulai Plan 2)

- **Mapping `PrismaClientKnownRequestError` ke envelope** di exception filter (atau interceptor khusus): `P2002` (unique constraint, mis. email duplikat saat register) → 409 dengan message manusiawi; `P2025` (record not found pada update/delete) → 404. Kode error Prisma TIDAK PERNAH bocor mentah ke response; selain kode yang di-mapping, jatuh ke 500 generik.
- **Transaction:** operasi multi-write yang harus atomik memakai `prisma.$transaction()` — contoh di auth: rotate refresh token (revoke lama + buat baru), link akun Google (null-kan password + revoke session + set googleId). Jangan andalkan urutan await terpisah.
- **Race condition register:** cek-dulu-baru-insert tetap bisa kalah race — insert langsung dan tangkap P2002 sebagai sumber kebenaran 409, bukan hanya pre-check `findUnique`.
- **Connection pooling:** pool dikelola driver adapter (`pg.Pool` di `@prisma/adapter-pg`); ukuran pool dikonfigurasi via env (`DATABASE_POOL_MAX`, default sane) dan didokumentasikan di deployment.md.

## D. Auth & Email Flow

### Toggle Verifikasi Email

Env var `AUTH_REQUIRE_EMAIL_VERIFICATION` (default `true` di `.env.example`).
- `true`: register → kirim email aktivasi; login ditolak (403) sampai verified.
- `false`: register → `isEmailVerified: true` langsung, bisa login seketika. Cek verifikasi di login di-skip.

### Endpoint

| Endpoint | Perilaku |
|---|---|
| `POST /auth/register` | Validasi DTO → cek email unik (409 kalau ada) → hash argon2 → buat user → (kalau toggle on) buat token verifikasi + push job email ke queue. Response `data: null`. |
| `POST /auth/verify-email` | Jalur utama: token di body (dipanggil frontend dari halaman verify). `GET` varian tetap disediakan untuk klik langsung. Token match hash + belum expired → set verified, hapus token (single-use). |
| `POST /auth/resend-verification` | Kirim ulang email aktivasi. Cooldown 1 menit (429 kalau spam). |
| `POST /auth/login` | Passport Local. Belum verified (toggle on) → 403. Akun Google-only (password null) → pesan jelas "Akun ini terdaftar via Google, silakan login dengan Google", bukan "credential salah". Sukses → access token (JWT ~15m) + refresh token (JWT ~7d, hash disimpan di DB) + data user dasar (id, name, email) di `data`. |
| `POST /auth/refresh` | Rotate refresh token, revoke yang lama. |
| `POST /auth/logout` | Revoke refresh token di DB. `data: null`. |
| `GET /auth/google` → `GET /auth/google/callback` | Passport Google Strategy. Email sudah ada → link akun (isi `googleId`). Belum ada → buat user, `isEmailVerified: true` langsung. Redirect ke frontend dengan token. |
| `POST /auth/forgot-password` | Response selalu sama ("Jika email terdaftar, link reset sudah dikirim") — enumeration protection. Token reset expiry 1 jam, single-use. |
| `POST /auth/reset-password` | Validasi token → update password → revoke SEMUA refresh token user. Juga jadi jalur set-password untuk akun Google-only. |

### Penyimpanan Token (Hybrid)

- **Klien web:** refresh token dikirim sebagai **httpOnly cookie** (Secure, SameSite=Lax, path terbatas ke endpoint refresh) — kebal pencurian via XSS. Access token di response body, disimpan client di memory (bukan localStorage).
- **Klien mobile:** refresh token juga tersedia di response body. Endpoint sama melayani keduanya (deteksi via ada/tidaknya cookie, atau header klien).
- Endpoint refresh menerima refresh token dari cookie ATAU body.

### Checklist Keamanan (WAJIB semua terpenuhi)

**Kritis:**
1. **Anti pre-registration takeover:** saat link Google ke akun yang `isEmailVerified: false`, NULL-kan password lama + revoke semua refresh token akun itu. (Tanpa ini: penyerang register email korban + password sendiri → korban login Google → verified → password penyerang aktif.)
2. **Refresh token reuse detection:** refresh token yang sudah di-rotate muncul lagi = indikasi pencurian → revoke SEMUA session user itu, bukan cuma tolak request.
3. **Brute force per-akun:** penghitung gagal login per akun di Redis (10x gagal → lock 15 menit), di atas throttle per-IP. `trust proxy` dikonfigurasi benar agar throttler membaca IP asli, dan `X-Forwarded-For` tidak bisa di-spoof dari luar.
4. **Anti timing enumeration di login:** email tidak ditemukan → tetap jalankan argon2 verify terhadap dummy hash agar durasi respons seragam.

**Menengah:**
5. **OAuth callback:** validasi `state` (CSRF), cek klaim `email_verified` dari Google, redirect URL hanya dari whitelist config (bukan parameter request). Token tidak ditaruh di query string callback — pakai one-time exchange code pendek yang frontend tukar via POST.
6. **Password policy:** min 8, **maks 128 karakter** (cap wajib — password raksasa = DoS argon2). Global body size limit (~1MB).
7. **Single-active-token:** menerbitkan token verifikasi/reset baru menghapus token lama bertipe sama milik user itu.
8. **JWT hygiene:** algoritma di-pin eksplisit (tolak `none`/algorithm confusion), secret BERBEDA untuk access vs refresh, panjang secret divalidasi Zod (min 32 char), validasi `iss`/`aud`.

**Hardening:**
9. Token verifikasi/reset: `crypto.randomBytes(32)` (CSPRNG), disimpan & di-lookup sebagai hash SHA-256, single-use.
10. Argon2**id** dengan parameter memory/time eksplisit yang sane.
11. Cooldown resend-verification dihitung per user (Redis), bukan per IP.
12. Throttle juga di verify-email & reset-password (anti token-guessing).
13. Audit log event auth (login sukses/gagal, reset, revoke); redaction pino agar token/password TIDAK PERNAH masuk log.
14. JWT strategy memvalidasi user masih ada & aktif di DB (token user terhapus/disabled ditolak).
15. Verify-email pakai `POST` sebagai jalur utama (email scanner korporat auto-klik link `GET`).
16. Rate limit ketat per-endpoint login / forgot-password / resend-verification (~5x/menit/IP), di atas throttle global.
17. Register 409 membocorkan keberadaan email — trade-off UX yang diterima sadar; forgot-password TIDAK bocor (respons selalu sama).
18. Email dikirim async via BullMQ, tidak memblokir request.

## E. Skema Database (Prisma)

```prisma
enum Role { USER ADMIN }
enum TokenType { EMAIL_VERIFICATION PASSWORD_RESET }

model User {
  id              String   @id @default(uuid())
  email           String   @unique
  password        String?          // null untuk akun Google-only
  name            String
  googleId        String?  @unique
  isEmailVerified Boolean  @default(false)
  role            Role     @default(USER)  // role GLOBAL aplikasi
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model VerificationToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String
  type      TokenType
  expiresAt DateTime  // 24 jam utk EMAIL_VERIFICATION, 1 jam utk PASSWORD_RESET
  createdAt DateTime  @default(now())
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
}
```

Prinsip: skema User hanya berisi yang dibutuhkan auth (YAGNI). Fitur team di masa depan hidup di tabel terpisah (`Team`, `TeamMember` dengan `invitedEmail`/`status` untuk invite-by-email) tanpa mengubah `User` — resepnya didokumentasikan di `docs/recipes/add-team-feature.md`. `User.role` (global) terpisah dari `TeamMember.role` (per-team).

Seeding: `prisma/seed.ts` membuat admin user awal.

## F. Dokumentasi (Friendly untuk AI Agent & Developer)

```
README.md               # ringkas: apa ini, quick start, link ke docs/
CLAUDE.md               # untuk AI agent: perintah penting, konvensi wajib,
                        # pointer ke docs/ yang relevan (bukan duplikat)
docs/
  getting-started.md    # setup: env, docker, migrate, seed, run
  architecture.md       # struktur folder, module system, alur request→response
  conventions.md        # penamaan, DTO, service, error handling, envelope
  api-reference.md      # semua endpoint + contoh request/response
  auth.md               # flow auth lengkap dengan diagram alur
  database.md           # skema, migration, seeding
  testing.md            # menjalankan & menulis test, pola mocking
  deployment.md         # Docker production, env, checklist deploy
  recipes/
    add-new-module.md
    add-oauth-provider.md
    add-team-feature.md
    switch-database.md  # ganti postgres → mysql/sqlite: provider, driver adapter, regenerate migration
```

Prinsip: satu topik satu file (mudah dimuat konteksnya oleh AI), `recipes/` berisi langkah-demi-langkah gaya dokumentasi Laravel, `CLAUDE.md` ringkas dan menunjuk ke docs.

`.env.example` lengkap dengan komentar per variabel.

## G. Testing

- **Unit:** contoh nyata `AuthService` — register dengan/tanpa toggle, login belum verified, akun Google-only login password. Referensi pola mocking Prisma & queue.
- **E2E:** `test/auth.e2e-spec.ts` — flow penuh register → verify → login → refresh → logout terhadap postgres test (docker-compose), schema reset tiap run, `MailService` di-mock (token diambil dari DB).
- Konfigurasi Jest terpisah: unit (`*.spec.ts`) vs e2e (`*.e2e-spec.ts`).

## H. Docker & CI

- `Dockerfile` multi-stage, production image ramping, non-root user.
- `docker-compose.yml` (dev): postgres + redis saja; app jalan di host untuk hot-reload.
- `docker-compose.prod.yml`: app + postgres + redis.
- GitHub Actions `ci.yml`: lint → build → unit test → e2e test (service container postgres + redis) pada setiap push & PR.

## I. Lain-lain

- Versioning URI: `/api/v1`.
- Global prefix + Swagger + health check seperti bagian A.
- ESLint + Prettier sudah ada; tambah Husky pre-commit (lint-staged).
- Tidak ada fitur di luar scope ini (no teams, no 2FA, no multi-tenancy di starter — hanya resep di docs).
