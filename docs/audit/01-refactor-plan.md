> Riwayat audit ini berasal dari project asli bernama loopwork-backend.
>
> nest-foundry adalah starter kit yang diekstrak dari codebase tersebut setelah seluruh proses refactor (W0-W3, Plan 5) dan dokumentasi operasional selesai. Nama 'loopwork' yang muncul di dalam dokumen ini sengaja dipertahankan sebagai konteks historis, bukan kesalahan yang belum diperbaiki.

# Refactor Plan — loopwork-backend

## BAGIAN 1: KONFORMANSI SPEC → KODE

| ID | Mekanisme / Klaim | Status | Bukti (Path & Baris) | Catatan Teknikal |
|---|---|---|---|---|
| **C-01** | Atomic single-use token via `$transaction` (TOCTOU-safe) | **Terimplementasi Penuh** | `src/modules/auth/verification.service.ts:68-78` | `deleteMany` bersyarat di dalam transaksi. Jika token sudah terhapus oleh request paralel, `count` bernilai 0 -> `BadRequestException` (rollback). Bebas TOCTOU race. |
| **C-02** | Anti timing-enumeration via dummy hashing | **Terimplementasi Sebagian** | `src/modules/auth/auth.service.ts:87-147` | Dummy hashing (`verifyDummy`) dipanggil untuk email tidak terdaftar dan akun Google-only. Cabang lockout (`attempts >= LOCKOUT_MAX`, line 91-97) melempar `HttpException` 429 **sebelum** hashing apa pun. Lihat revisi keparahan di bagian "Peninjauan Ulang" — tidak lagi dinilai Tinggi. |
| **C-03** | Refresh token rotation dengan auto-revoke seluruh sesi saat reuse | **Terimplementasi Penuh** | `src/modules/auth/token.service.ts:54-62, 72-85` | Token dengan `revokedAt !== null` terdeteksi reuse -> `revokeAllForUser(userId)`. Race TOCTOU antar-rotate ditutup lewat `updateMany` bersyarat (`revokedAt: null` -> `new Date()`) di dalam `$transaction`, dengan `TokenAlreadyConsumedError` sebagai sinyal rollback. |
| **C-04** | Global envelope response interceptor | **Terimplementasi Penuh untuk kelas response yang relevan** | `src/common/interceptors/transform.interceptor.ts:9-38` | Bekerja otomatis untuk semua return controller JSON (2xx) dan error JSON (4xx/5xx via `AllExceptionsFilter`). Redirect 302 pada `GET /auth/google/callback` dan `GET /auth/google/reauth/callback` tidak memiliki body JSON sama sekali — **bukan pelanggaran envelope**, karena tidak ada payload untuk dibungkus. Lihat revisi di bagian "Peninjauan Ulang": temuan C-04b **dicabut**. |

---

## BAGIAN 2: VERIFIKASI TIGA TEMUAN AWAL

### S-01: State Per-Proses (InMemory Throttler) vs Shared State (Redis Lockout)
- **Status:** **TERKONFIRMASI (Fakta)**
- **Bukti:** `src/app.module.ts:42` -> `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])`, tanpa storage adapter Redis.
- **State inventory lengkap:**
  - Throttler (in-memory): **tidak shared** — bocor di multi-pod.
  - Lockout (`auth:lockout:{email}`, Redis): shared, aman.
  - OAuth CSRF state & exchange code (Redis): shared, aman.
  - BullMQ queue jobs (Redis): shared, aman.

### S-02: Prisma Mock Ketinggalan (`refreshToken` Hilang)
- **Status:** **TERKONFIRMASI (Fakta)**
- **Bukti:** `src/prisma/__mocks__/prisma.service.ts` hanya punya `user`, `verificationToken`, `$transaction` — tidak ada `refreshToken` sama sekali (bukan cuma tidak lengkap, benar-benar tidak ada).
- **Masalah:** `token.service.spec.ts` wajib menulis mock manual ad-hoc, melanggar prinsip "satu mock global". Drift berulang tiap model baru ditambah ke schema.

### S-03: `auth.controller.ts` Menggemuk & Tidak Memiliki Unit Test
- **Status:** **TERKONFIRMASI (Fakta), skala lebih besar dari perkiraan awal**
- **Bukti:** `src/modules/auth/auth.controller.ts` = 426 baris, **15 route handler** (google, google/callback, google/exchange, register, verify-email, resend-verification, login, refresh, logout, forgot-password, reset-password, change-password, google/reauth, google/reauth/callback, set-password, unlink-google). Tidak ada `auth.controller.spec.ts`.
- **Duplikasi konkret:** `extractRefreshToken` dan `setRefreshCookie` dipanggil di 4 handler; `redirectGoogleFailure` dan `redirectReauthFailure` adalah dua method privat yang identik isinya (hanya nama beda) — DRY violation kecil, bukan bug.

---

## BAGIAN 3: DIMENSI ANALISIS (LENGKAP A–L)

### A. Kesiapan sebagai Template

**A1. "Tambah modul domain baru" — langkah konkret & titik tersandung:**
1. Tambah model di `prisma/schema.prisma` → `npm run prisma:migrate`.
2. Tambah properti model baru manual ke `src/prisma/__mocks__/prisma.service.ts` (lihat S-02 — tidak ada generator, manual dan mudah lupa).
3. Buat folder `src/modules/<nama>/` dengan controller + service + dto + module sendiri.
4. Import module baru ke `imports: []` di `src/app.module.ts` secara manual — tidak ada auto-discovery.
5. Kalau butuh list endpoint: pakai `PaginationQueryDto` + `paginate()` helper (`src/common/helpers/paginate.helper.ts`) — helper ini **sudah ada dan sudah ditest**, tapi **belum dipakai di controller manapun**. Developer baru tidak punya contoh pemakaian nyata di controller, hanya spec file.
- **Modul kanonik untuk dicontoh:** **Tidak ada satu pun modul yang benar-benar layak jadi contoh lengkap.**
  - `HealthModule` terlalu tipis (tanpa service, tanpa DTO, tanpa Prisma write).
  - `UsersModule` cuma 1 endpoint baca (`GET /users/me`), tidak ada create/update/delete, tidak ada DTO folder.
  - `AuthModule` terlalu berat & auth-spesifik untuk dijadikan contoh modul domain generik.
  - **Ini sendiri adalah temuan (A-01):** starter belum punya "modul referensi" CRUD sederhana yang memakai envelope + pagination + DTO validation secara end-to-end.

**A2. "Tambah provider OAuth baru" (mis. GitHub):**
- Sama seperti temuan sebelumnya: `google-oauth.service.ts` dan `google.strategy.ts` hardcode nama "Google" di key Redis (`oauth:google:state:*`, `oauth:google:code:*`), nama method (`resolveGoogleUser`), dan DTO (`GoogleExchangeDto`). Menambah GitHub berarti duplikasi file penuh. Belum ada interface `OAuthProvider` generik. (A-02, tetap berlaku.)
- **Catatan tambahan:** Google OAuth di kode **sudah production-complete** (login, reauth, unlink, set-password) — bukan lagi "sedang direncanakan" seperti tertulis di `CLAUDE.md` Progress Plan (lihat temuan L-01 di bawah, ini drift dokumentasi). Artinya refactor ke provider generik sekarang adalah refactor pada kode yang **sudah live**, bukan pre-implementation — beri tag **[BREAKING]** karena mengubah nama service/method yang sudah dipakai controller & test.

**A3. "Tambah fitur team" (single-tenant constraint):**
- Titik tersandung konkret: `AuthenticatedUser` (`src/common/decorators/current-user.decorator.ts:4-9`) dan `JwtPayload` (`token.service.ts`) hanya membawa `sub`/`id`, tidak ada slot untuk `activeTeamId`. `JwtStrategy.validate` (`src/modules/auth/strategies/jwt.strategy.ts:29-36`) membangun `AuthenticatedUser` langsung dari `UsersService.findById`, tanpa lapisan context tenant.
- Ini murni struktural (bukan bug) — YAGNI yang disengaja, konsisten dengan `docs/recipes/add-team-feature.md` yang direncanakan sebagai resep terpisah, bukan bagian starter core.

### B. Konsistensi Lintas Modul auth/users/health
- **Struktur modul tidak seragam** — bukan soal benar/salah, tapi tidak ada "template modul" yang bisa dicontoh (lihat A1). `AuthModule` = controller+5 service+3 strategy+2 guard+banyak DTO; `UsersModule` = controller+service, tanpa DTO; `HealthModule` = controller saja.
- **Response shape Health vs domain lain:** `HealthController.check()` (`src/modules/health/health.controller.ts:22-38`) mengembalikan object Terminus asli (`{ status, info, error, details }`) yang dibungkus interceptor jadi `{ success, message, data: <shape Terminus> }`. Domain lain selalu mengembalikan `data` berbentuk DTO/entity biasa. Konsumen API harus tahu shape `data` khusus untuk endpoint health — ini bukan pelanggaran envelope (masih terbungkus `success/message/data`), tapi inkonsistensi bentuk `data` yang layak didokumentasikan di API reference (yang belum ada, lihat L).
- **DTO validation message:** Semua DTO auth yang diperiksa konsisten memakai pola validasi `class-validator` standar. Tidak ditemukan DTO yang melewatkan `ValidationMessage` helper.

### C. Controller Tipis & Cross-Cutting Concern
- **Cookie & token extraction** (`extractRefreshToken`, `setRefreshCookie`, `auth.controller.ts:405-425`): logic HTTP murni terulang di login/refresh/logout/change-password/set-password/unlink-google (6 pemanggilan). Layak jadi `@RefreshToken()` param decorator + interceptor `@SetRefreshCookie()`.
- **OAuth redirect duplikasi:** `redirectGoogleFailure` dan `redirectReauthFailure` (`auth.controller.ts:389-403`) isinya identik (base URL + `error=oauth_failed` + redirect). Bukan bug, tapi DRY nit — bisa disatukan jadi satu private method dengan parameter opsional.

### D. Batas Modul & DI
- `AuthModule` menampung `TokenService`, `AuthService`, `VerificationService`, `PasswordService`, `GoogleOAuthService`, `LocalStrategy`, `JwtStrategy`, `GoogleStrategy`, `GoogleOAuthGuard`, `GoogleReauthGuard` — 10 provider dalam satu modul flat. Layak displit ke submodule internal (`AuthCoreModule`, `TokenRotationModule`, `OAuthModule`) — sama seperti draft awal, tetap valid, sekarang dengan jumlah provider terkonfirmasi.

### E. State Terdistribusi & Kesiapan Deploy
Sama seperti S-01, ditambah:
- **ioredis failure mode:** koneksi Redis diinstansiasi global (`redis.module.ts`) dan dipakai sinkron di jalur lockout & OAuth. Jika Redis mati, endpoint auth fail-closed — trade-off keamanan yang benar, bukan bug.

### F. Lapisan Data (Prisma)
- **Graceful shutdown:** `app.enableShutdownHooks()` + `PrismaService implements OnModuleDestroy` -> `$disconnect()`. **Aman, terverifikasi.**
- **Index & migrasi:** `RefreshToken` punya `@@index([userId])`, `VerificationToken` punya `@@index([userId, type])` — index FK lookup sudah benar. Hanya 2 migration nyata (`20260709102826_init`, `202608120001_add_google_unlinked_at`) + `migration_lock.toml` — tidak ada tanda drift antara schema dan riwayat migrasi.
- **Sensitive data leakage (F-02, baru dikonfirmasi):** `grep -rn "select:" src/modules` **tidak menemukan satu pun** query dengan `select` eksplisit. `UsersService.findByEmail`/`findById` (`users.service.ts:15-21`) selalu mengembalikan `User` penuh termasuk kolom `password` (hash). Saat ini aman karena controller yang memanggilnya (`AuthService`, `JwtStrategy`) selalu memetakan ulang ke DTO manual sebelum return — tapi tidak ada guard struktural yang mencegah controller baru me-return `user` Prisma mentah. Risiko laten, bukan kebocoran aktif hari ini.

### G. Konfigurasi & Lingkungan
- **Node version tidak dipin** — tidak ada `.nvmrc`, tidak ada `engines` di `package.json`. Tetap berlaku, tinggi risiko untuk Plan 5.

### H. Pekerjaan Asinkron (BullMQ) — **koreksi dari draft awal**
- **Retraksi:** Draft awal (`01-refactor-plan.md` versi pertama) menyatakan "belum mengonfigurasi backoff strategy eksplisit" — ini **salah**, dicabut. Bukti: `src/mail/mail.queue.ts:26-33` sudah mengonfigurasi `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`, `removeOnComplete: true`, `removeOnFail: 100` secara eksplisit per job.
- **Temuan baru (H-01):** Tidak ada mekanisme idempotensi di `MailProcessor.process()` (`src/mail/mail.processor.ts:16-27`) — jika job retry (mis. attempt ke-2 setelah timeout provider Resend padahal email ke-1 sebenarnya terkirim), tidak ada dedup key untuk mencegah kiriman ganda ke user yang sama. Dampak: Sedang (bukan keamanan, tapi UX — user bisa terima 2 email verifikasi).
- **Temuan baru (H-02):** `removeOnFail: 100` menyimpan job gagal di Redis tapi tidak ada consumer/alerting untuk job yang masuk kondisi ini (tidak ada dead-letter processing atau log terpisah untuk "job exhausted all retries"). Dampak: Rendah untuk starter, tapi worth didokumentasikan sebagai operational gap sebelum Plan 5.

### I. Timing / Enumeration (sebelumnya C-02b) — lihat "Peninjauan Ulang"

### J. Testing & Mock Drift
- Sudah tercakup penuh di S-02/S-03. Tambahan: tidak ditemukan spec untuk `HealthController`, `UsersController` selain default template — cakupan test terkonsentrasi di modul auth, wajar untuk starter fase ini, bukan temuan baru.

### K. Type Safety (`any`/`as`/`@ts-ignore`, strict mode) — **belum ditelusuri di draft awal, sekarang lengkap**
- **Tidak ada** `@ts-ignore` atau `@ts-expect-error` di `src/`.
- **Tidak ada** bare `any` type annotation di kode aplikasi (di luar `generated/` dan `__mocks__/`).
- **11 type assertion (`as X`)** ditemukan, seluruhnya di titik yang secara struktural butuh cast (Passport `req.user` yang diketik `any` oleh library, `error` di catch block, `JSON.parse` hasil Redis) — bukan penyalahgunaan untuk membungkam compiler.
- **Temuan baru (K-01):** `tsconfig.json` mengaktifkan `strictNullChecks: true` tapi **`noImplicitAny: false`** dan `strictBindCallApply: false`. Ini bukan mode `strict: true` penuh — starter mengklaim type-safety tapi compiler belum di setelan paling ketat. Dampak: Sedang. Mengaktifkan `noImplicitAny: true` sekarang (pre-release, breaking cheap) kemungkinan hanya butuh sedikit anotasi tambahan karena kode sudah bersih dari `any` eksplisit — tapi ini harus divalidasi dengan menjalankan `tsc --noEmit` setelah toggle, belum dicoba di audit ini.

### L. Dokumentasi — **belum ditelusuri di draft awal, sekarang lengkap**
- **Temuan baru (L-01, drift serius):** `CLAUDE.md` bagian "Progress Plan" menandai `⏳ Plan 4: Google OAuth` sebagai **belum dikerjakan**. Tapi kode di `auth.controller.ts` menunjukkan Google OAuth (login, reauth, unlink, set-password) **sudah lengkap dan production-ready**, didukung riwayat commit (`b8b6adf feat(auth): add password management and Google reauthentication`, `bd59d59 fix(auth): complete Google reauth callback and harden reset enumeration`). Dokumen progress-tracking yang jadi rujukan wajib (`CLAUDE.md`) **sudah tidak sinkron dengan kode**. Ini prioritas tinggi untuk diperbaiki karena `CLAUDE.md` adalah sumber kebenaran yang di-load otomatis ke setiap sesi kerja.
- Confirmed berulang dari `00b-project-context.md`: `README.md` masih template default `@nestjs/cli`, dan `docs/getting-started.md`, `docs/conventions.md`, `docs/api-reference.md`, `docs/recipes/*` semuanya belum ada.

---

## PENINJAUAN ULANG (per instruksi eksplisit)

### C-04b — DICABUT
Redirect 302 tidak memiliki body JSON, jadi "melewati envelope" bukan bug — tidak ada payload untuk dibungkus. Jalur error kedua callback OAuth (`redirectGoogleFailure`, `redirectReauthFailure`) sama-sama konsisten: base URL + `error=oauth_failed` generik, tidak ada informasi internal yang bocor, tidak ada perbedaan bentuk antara jalur `google/callback` dan `google/reauth/callback`. **Tidak ada temuan valid di sini** selain DRY nit kosmetik (dua method identik, lihat Dimensi C) yang tidak masuk tabel prioritas karena dampaknya nol.

### C-02b — DITURUNKAN dari Tinggi ke Rendah
Fakta baru: respons untuk akun terkunci (429 `Too many login attempts...`) **memang berbeda status code dan pesan** dari login gagal biasa (401 `Invalid email or password.`). Tapi ini **tidak menambah risiko enumerasi status registrasi email** — kunci lockout (`auth:lockout:{email}`) di-set berdasarkan string email yang dicoba, terlepas dari apakah email itu terdaftar atau tidak (lihat `auth.service.ts:88-97`, lockout check terjadi **sebelum** `findByEmail`). Jadi 429 vs 401 hanya membocorkan "email ini sudah gagal login 10x belakangan" — bukan "email ini terdaftar atau tidak", yang adalah properti yang ingin dilindungi C-02.

Karena status 429 sudah membedakan kondisi lockout secara instan dan gratis (tanpa perlu analisis timing sama sekali), menambal timing leak di cabang lockout memberi manfaat keamanan yang sangat kecil — penyerang tidak butuh timing analysis, cukup baca status code. Rekomendasi: turunkan ke **Rendah**, dan pertimbangkan masuk **"Sengaja Tidak Direfactor"** karena 429 vs 401 kemungkinan memang perlu dibedakan untuk UX klien ("coba lagi nanti" vs "password salah"). Tetap didaftar di tabel prioritas untuk keputusan eksplisit, bukan dieksekusi otomatis.

---

## VERIFIKASI TAMBAHAN (sebelum eksekusi W0)

### V-1: F-02 — Kritis atau laten?
Ditelusuri seluruh handler yang menyentuh objek `User`, sampai bentuk response akhir:

| Endpoint | Return path | Password hash ke klien? |
|---|---|---|
| `POST /auth/register` | `AuthService.register()` -> `RegisterResponseDto` mapping manual, tanpa field password | Tidak |
| `POST /auth/login` | `AuthService.login()` -> object literal manual `{id,name,email,avatarUrl,role}` (`auth.service.ts:164-174`) | Tidak |
| `POST /auth/google/exchange` | delegasi ke `auth.login()` yang sama | Tidak |
| `GET /users/me` | `AuthenticatedUser` dibangun manual di `JwtStrategy.validate` (`jwt.strategy.ts:29-36`), tanpa password | Tidak |
| `refresh`/`logout`/`change-password`/`set-password`/`unlink-google` | semua return `null` | Tidak |
| `google/callback`, `google/reauth/callback` | redirect 302, tanpa body JSON | Tidak |

E2e mengonfirmasi eksplisit: `test/auth.e2e-spec.ts:83-84` -> `expect(body.data).not.toHaveProperty('password')`.

**Kesimpulan tegas: tidak ada endpoint yang saat ini mengirim password hash. F-02 tetap laten, BUKAN kritis, TIDAK naik ke puncak W0.** Setiap titik keluar sudah mapping manual ke shape terbatas; risikonya murni struktural (tidak ada guard yang mencegah controller baru lalai return `user` mentah), bukan kebocoran yang sudah terjadi.

**`omit` global vs `select` eksplisit:** `omit` global pada `PrismaService` (didukung Prisma 7, mis. `omit: { user: { password: true } }` di konstruksi client) lebih tahan kelalaian — bersifat fail-safe/opt-out, berlaku otomatis untuk **setiap** query termasuk yang ditulis developer starter di masa depan tanpa perlu diingat. `select` eksplisit per query bersifat fail-unsafe/opt-in — mudah lupa persis di titik yang justru paling berisiko (controller baru yang ceroboh). **Rekomendasi: `omit` global**, jadwal tetap W1 (bukan W0, karena tidak ada kebocoran aktif untuk ditambal darurat).

### V-2: K-01 — Angka `noImplicitAny`
`noImplicitAny: true` dinyalakan sementara, `tsc --noEmit` dijalankan, konfigurasi dikembalikan setelahnya (`git diff --stat tsconfig.json` bersih, tidak ada perubahan tersisa).

**Hasil: 0 error, di 0 file.** Diuji sekali lagi dengan `strict: true` penuh (termasuk `strictBindCallApply`) — hasil tetap 0 error.

**Kesimpulan: kode sudah 100% bersih untuk strict mode penuh tanpa remediasi apa pun.** Ini bukan pekerjaan berskala W3 — cukup toggle satu baris di `tsconfig.json`, tanpa risiko regresi. **K-01 pindah dari W1 ke W0.**

### V-3: A-02 & S-03 — dinilai ulang dengan fakta Plan 4 sudah selesai
- **A-02 — turun ke backlog bersyarat (bukan lagi bagian roadmap aktif).** Argumen "lebih murah sebelum OAuth ditambah" sudah gugur — Google OAuth sekarang live dengan `test/google-oauth.e2e-spec.ts` yang harus tetap hijau. Refactor ke `OAuthProvider` generik sekarang berarti rename pada surface yang sudah diuji dan dipakai controller, bukan lagi greenfield — murni YAGNI sampai provider OAuth kedua benar-benar diminta oleh proyek turunan nyata. **Effort direvisi naik: M (~5j) -> L (~8j)**, karena harus menjaga hijau `google-oauth.e2e-spec.ts` + seluruh `auth.e2e-spec.ts`, bukan cuma unit test.
- **S-03 — tetap valid, effort naik sedikit, prasyarat ke A-02 dilepas.** Independen dari status Plan 4 — masalahnya (426 baris, 15 endpoint tanpa unit test) makin berat justru karena Plan 4 menambah 4 endpoint (`google/reauth`, `google/reauth/callback`, `set-password`, `unlink-google`) yang juga belum punya test. **Effort direvisi: M (~6j) -> M/L (~7j)** untuk mencakup endpoint reauth tambahan. S-03 sekarang bisa jalan sendiri tanpa menunggu A-02.

---

## TABEL PRIORITAS REFACTOR — STATUS W0 SELESAI (Dampak ÷ Effort)

| ID | Judul Temuan | Kategori | Dampak | Status | Commit | Effort | Blast Radius |
|---|---|---|---|---|---|---|---|
| **L-01** | `CLAUDE.md` Progress Plan tidak sinkron — Plan 4 ditandai belum padahal sudah lengkap | L | Tinggi | ✅ SELESAI | `5817c54` | S | 1 file |
| **F-01** | Mock Prisma global tidak memiliki model `refreshToken` | J | Tinggi | ✅ SELESAI | `123fe6d` | S | 4 file |
| **G-01** | Node.js runtime version tidak di-pin | G | Tinggi | ✅ SELESAI | `35d0d18` | S | 3 file |
| **K-01** | `tsconfig.json` tidak `strict: true` penuh — **terverifikasi 0 error jika dinyalakan** | K | Tinggi (murah+aman) | ✅ SELESAI | `88af1c6` | S | 1 file |
| **S-01** | Throttler masih menggunakan in-memory storage | E | Tinggi | ✅ SELESAI | `66b89cd` | S | 3 file |
| **S-03** | `AuthController` terlalu gemuk (15 endpoint) dan tanpa unit test | J/C | Tinggi | ✅ SELESAI | `7c82cee` | M/L (~7j) | 3-4 file |
| **A-01** | Modul domain kanonik untuk dicontoh developer starter (`UsersModule` self CRUD) | A | Sedang | ✅ SELESAI | `5e6f9e5` | M | 4-5 file |
| **F-02** | Query User tidak pakai `select`/`omit` eksplisit — **dikonfirmasi laten, tidak aktif bocor** | F | Sedang | ✅ SELESAI | `7c82cee` | S (`omit` global) | 1 file |
| **H-01** | `MailProcessor` tidak idempoten pada retry job | H | Sedang | ⏳ W3 | - | S | 1 file |
| **C-02b** | Timing leak dummy-hash pada cabang lockout — dampak diturunkan | I | Rendah | Opsional | - | S | 1 file |
| **H-02** | Tidak ada visibility/alerting untuk job yang exhaust semua retry | H | Rendah | ⏳ W3 | - | S | dok + config |
| **A-02** | Google OAuth hardcoded, tanpa `OAuthProvider` seam — **[BREAKING]**, backlog bersyarat | A | Rendah (saat ini) | ⏳ Backlog | - | L (~8j) | 4+ file |

*(C-04b tetap dicabut, tidak masuk tabel.)*

---

## ROADMAP IMPLEMENTASI — REVISI (W0–W4)

### W0 — Pengaman (Clean State & Test/Doc Trust) — ✅ SELESAI
- **Tujuan:** Menjamin test suite dan dokumentasi rujukan bisa dipercaya, plus mengunci strict mode selagi kode masih 100% bersih.
- **Daftar ID:** `L-01` (`5817c54`), `F-01` (`123fe6d`), `G-01` (`35d0d18`), `K-01` (`88af1c6`), `S-01` (`66b89cd`)
- **Status:** ✅ 5/5 temuan terimplementasi, teruji (tsc 0, lint 0, 26 unit test suite / 139 test hijau), dan ter-commit terpisah. Rate limit terverifikasi manual bertambah seamless di Redis lintas restart proses.

### W1 — Slim Controller & Data Safety — ✅ SELESAI
- **Tujuan:** Merampingkan `AuthController` (sekarang 15 endpoint termasuk reauth) dan menutup risiko laten kebocoran password hash dengan mekanisme fail-safe.
- **Daftar ID:** `S-03` (`7c82cee`), `F-02` (`7c82cee`), spec migration (`a191ff1`)
- **Status:** ✅ 2/2 temuan terimplementasi, teruji (tsc 0, lint 0, 30 unit test suite / 166 test hijau, 4 e2e test suite / 34 test hijau).

### W2 — Modul Referensi Domain — ✅ SELESAI
- **Tujuan:** Menjadikan `UsersModule` modul CRUD kanonik (self profile GET/PATCH/DELETE) yang lengkap dengan DTO validation, ResponseMessage, Swagger, unit tests, dan e2e tests sebagai acuan developer starter.
- **Daftar ID:** `A-01`
- **Status:** ✅ Terimplementasi, teruji (tsc 0, lint 0, 31 unit test suite / 177 test hijau, 5 e2e test suite / 37 test hijau).

### W3 — Operasional (prasyarat Plan 5) — ✅ SELESAI
- **Tujuan:** Tutup gap operasional BullMQ sebelum Docker+CI digarap.
- **Status:** ✅ SELESAI (H-01 Dua lapisan idempotensi dengan DB claim & rollback + H-02 Dead-letter listener via `QueueEventsListener`).
- **Daftar ID:** `H-01`, `H-02`
- **Definisi selesai:** `MailProcessor` idempoten (dedup `jobId` & DB state `sentAt` dengan rollback saat error); `MailEventsListener` mencatat log error saat job exhausted.
- **Catatan Operasional Production:** Dead-letter logging pada H-02 disalurkan ke application log (`pino` / `nestjs-pino`). Di lingkungan produksi nyata, pengembang disarankan menyambungkan log error ini (atau event `failed` BullMQ) ke sistem alerting eksternal seperti Sentry atau PagerDuty.

### W4 — Docker, CI & Dokumentasi — SELESAI
- **Tujuan:** Multi-stage Dockerfile, production docker-compose, CI GitHub Actions, update README, dan dokumentasi operasional lengkap (`docs/`).
- **Status:** ✅ SELESAI (`Dockerfile`, `docker-compose.prod.yml`, `.github/workflows/ci.yml`, `README.md`, `AGENTS.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/getting-started.md`, `docs/api-reference.md`, `docs/recipes/*`).
- **Daftar ID:** Plan 5 & Docs
- **Definisi selesai:** Docker multi-stage Node 24 non-root, compose stack lengkap, CI job terpisah (lint, tsc, unit, e2e), README & seluruh dokumentasi operasional lengkap dan diverifikasi.

### Backlog bersyarat (tidak dijadwalkan ke wave manapun)
- **`A-02`** — OAuth provider generik. **Syarat pemicu eksekusi:** Dikerjakan HANYA saat menulis dokumentasi resep `docs/recipes/add-oauth-provider.md` ATAU saat provider OAuth kedua (mis. GitHub/Apple) benar-benar dibutuhkan oleh proyek turunan nyata, mana yang terjadi lebih dulu. Effort terrevisi L (~8j) karena harus menjaga 2 e2e suite tetap hijau.

---

## SENGAJA TIDAK DIREFACTOR (Accepted Design Choices)

1. **Bentuk Response 409 Membocorkan Email Terdaftar (register):**
   *Alasan:* Dibiarkan demi kenyamanan UX registrasi.
   *Kapan ditinjau ulang:* Jika starter dipakai untuk domain privasi tinggi (medis/finansial).
2. **Duplikasi Zod (Config) dan Class-Validator (DTO):**
   *Alasan:* Masing-masing optimal di layernya — Zod untuk coercion env, class-validator terintegrasi `ValidationPipe`.
   *Kapan ditinjau ulang:* Jika salah satu ditinggalkan komunitas atau konflik mayor dengan NestJS 11.
3. **Model Single-Tenant Murni pada Database:**
   *Alasan:* YAGNI — starter harus sesederhana mungkin.
   *Kapan ditinjau ulang:* Saat proyek turunan benar-benar butuh multi-tenant.
4. **(Kandidat baru) Status 429 berbeda dari 401 pada lockout login:**
   *Alasan:* Klien butuh membedakan "coba lagi nanti" vs "password salah" secara UX; menyamakan status akan merusak UX tanpa menambah proteksi anti-enumerasi email yang berarti (lihat C-02b).
   *Kapan ditinjau ulang:* Jika threat model starter berubah untuk secara eksplisit menyembunyikan status lockout dari klien (jarang diperlukan).
5. **DELETE /users/me tidak meminta konfirmasi password ulang:**
   *Alasan:* Sengaja untuk kesederhanaan starter core perancah (endpoint `DELETE /users/me` sudah terotentikasi via JWT `@CurrentUser()`, dan relasi `RefreshToken`/`VerificationToken` memakai `onDelete: Cascade` sehingga sesi multi-device terhapus bersih dengan 401).
   *Kapan ditinjau ulang:* Jika proyek turunan membutuhkan proteksi ekstra (mis. reauthentication prompt sebelum menghapus akun).

---

## PERTANYAAN STRATEGIS (Butuh Keputusan)

1. **Node.js Engine Target:** Pin ke Node 22 LTS untuk Docker & GitHub Actions matrix?
2. **OAuth Provider Generik:** Bangun `OAuthProvider` interface sekarang (biaya [BREAKING] pada kode Google yang sudah live), atau tunda sampai provider kedua benar-benar dibutuhkan?
3. **Throttler Redis Storage:** Izin instal `@nestjs/throttler-storage-redis` (atau setara)?
4. **Mock Generation Otomatis:** Perlu generator otomatis untuk `__mocks__/prisma.service.ts`, atau cukup tipe ketat manual (structural check via `tsc`)?
5. **C-02b — Timing di cabang lockout:** Setuju masuk "Sengaja Tidak Direfactor" (karena 429 vs 401 sudah membocorkan status lockout secara eksplisit, jadi menambal timing tidak menaikkan keamanan secara berarti), atau tetap ingin ditambal demi hygiene meski manfaatnya marjinal?
6. **E2E Test CI Strategy:** GitHub Services (Redis+Postgres hidup) atau fallback integration test?
7. **`CLAUDE.md` Progress Plan (L-01):** Boleh saya update bagian Progress Plan sekarang untuk mencerminkan status Plan 4 yang sebenarnya (Google OAuth sudah lengkap), sebagai bagian dari W0 — atau ingin ditinjau manual dulu?
