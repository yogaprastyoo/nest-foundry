# Design Spec: Starter Improvements

**Date:** 2026-08-13  
**Status:** Approved  
**Scope:** Password Reset, BullMQ Webhook Alerting, Graceful Shutdown, Enhanced Helmet Security Config.

---

## 1. Password Reset Flow

### 1.1 Endpoints
- `POST /api/v1/auth/forgot-password`
  - Guard: `@Public()`, Rate Limit 5/min.
  - Body: `ForgotPasswordDto` (`email: string`).
  - Response: `{ success: true, message: "If an account with that email exists, password reset instructions have been sent." }`.
  - Logic:
    - Check user existence. If non-existent, run dummy hash delay (anti-timing) & return uniform 200.
    - Check Redis cooldown (60s) & quota (5/hr).
    - Single active token per user & type (`TokenType.PASSWORD_RESET`). Delete old ones.
    - Generate 256-bit CSPRNG token (32 bytes hex), store SHA-256 in `VerificationToken`.
    - Enqueue BullMQ job `send-password-reset-email`.

- `POST /api/v1/auth/reset-password`
  - Guard: `@Public()`, Rate Limit 5/min.
  - Body: `ResetPasswordDto` (`token: string`, `newPassword: string`).
  - Response: `{ success: true, message: "Password reset successful. Please log in with your new password." }`.
  - Logic:
    - Hash incoming token with SHA-256.
    - Find token in DB where `type: PASSWORD_RESET` & `expiresAt > NOW()`.
    - Execute `$transaction`:
      1. Delete token (`deleteMany count === 1` for single-use TOCTOU protection).
      2. Hash new password with Argon2.
      3. Update user password.
      4. **Revoke all active refresh tokens for the user** (`deleteMany` on `refresh_tokens`).

### 1.2 Queue & Mail Template
- Mail template: `src/mail/templates/password-reset-email.template.ts` (HTML + Plain text).
- Queue job handler in `MailProcessor` for `send-password-reset-email`.

---

## 2. BullMQ Webhook Alerting

### 2.1 Mechanism
- Add optional environment variable `ALERT_WEBHOOK_URL` in `src/config/env.validation.ts` (valid URL string or empty/undefined).
- In `src/mail/mail.processor.ts`, inside `@OnWorkerEvent('failed')`:
  - When `job.attemptsMade >= job.opts.attempts` (max retries reached):
  - Send HTTP `POST` via native `fetch()` to `ALERT_WEBHOOK_URL` if configured.
  - Payload: `{ event: "job_failed", queue: "mail-queue", jobId: job.id, jobName: job.name, error: error.message, timestamp: ISOString }`.
  - Handle fetch error gracefully with pino error log (no unhandled rejection).

---

## 3. Graceful Shutdown

### 3.1 RedisModule & QueueModule Shutdown
- Implement `OnModuleDestroy` lifecycle hook in `src/redis/redis.module.ts` / provider to close IORedis connection gracefully (`redis.quit()`).
- Implement `OnModuleDestroy` in `src/mail/mail.processor.ts` or worker host to pause/close BullMQ worker cleanly.

---

## 4. Enhanced Helmet Security Config

### 4.1 Header Adjustments
- Update `app.use(helmet(...))` in `src/main.ts`:
  - `crossOriginResourcePolicy: { policy: "cross-origin" }` (for avatar image assets if served).
  - Content Security Policy (CSP) directives adjusted so OpenAPI/Swagger UI scripts run without restriction in non-production environments.

---

## 5. Verification Plan

- Unit tests:
  - `auth.service.spec.ts` / `password-reset.spec.ts` for forgot & reset password logic.
  - `mail.processor.spec.ts` for webhook call on max retry failure.
- E2E tests:
  - `forgot-reset-password.e2e-spec.ts` testing request flow, invalid tokens, expired tokens, and session revocation after reset.
- Pipeline check: `npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e`
