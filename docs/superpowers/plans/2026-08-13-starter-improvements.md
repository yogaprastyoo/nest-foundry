# Starter Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Password Reset flow, BullMQ Webhook Alerting on job failure, Graceful Shutdown hooks for Redis & BullMQ worker, and CSP / Helmet security header enhancements.

**Architecture:** Extend NestJS AuthModule & MailModule using existing Prisma `VerificationToken` model, IORedis shutdown lifecycle hooks, native `fetch()` for webhook alerts in BullMQ processor, and express Helmet configuration in `main.ts`.

**Tech Stack:** NestJS 11, TypeScript, Prisma, BullMQ, IORedis, Argon2, Helmet.

**Spec:** `docs/superpowers/specs/2026-08-13-starter-improvements-design.md`

## Global Constraints

- User-facing error & validation messages must be in English.
- Use `import type` for interface-only imports.
- Password hash field omitted by default in Prisma queries; use `findByEmailWithPassword` / explicit selects.
- Verification pipeline before task completion: `npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e`.

---

### Task 1: Password Reset DTOs, Templates, & Service Logic

**Files:**
- Create: `src/modules/auth/dto/forgot-password.dto.ts`
- Create: `src/modules/auth/dto/reset-password.dto.ts`
- Create: `src/mail/templates/password-reset-email.template.ts`
- Create: `src/mail/templates/password-reset-email.template.spec.ts`
- Modify: `src/mail/mail.processor.ts`
- Modify: `src/mail/mail.queue.ts`
- Modify: `src/modules/auth/verification.service.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Test: `src/modules/auth/auth.service.spec.ts`

- [x] **Step 1: Create DTOs**

Write `ForgotPasswordDto` with `@NormalizeEmail()`, `@IsEmail()`, `@IsNotEmpty()` and `ResetPasswordDto` with `@IsNotEmpty()`, `@IsString()`, `@MinLength(8)`.

- [x] **Step 2: Create Mail Template & Queue Job Handling**

Write `renderPasswordResetEmail(recipient: string, resetUrl: string)` in `password-reset-email.template.ts`.
Add unit test for template string format.
Add `sendPasswordResetEmail(userId: string, email: string, token: string)` to `MailQueue` and processor handling for `send-password-reset-email`.

- [x] **Step 3: Implement Password Reset Service Methods**

In `VerificationService`: add `createPasswordResetToken(userId: string, email: string)`.
In `AuthService`: add `forgotPassword(dto: ForgotPasswordDto)` and `resetPassword(dto: ResetPasswordDto)` which resets password and deletes all refresh tokens for the user.

- [x] **Step 4: Run Unit Tests**

Run: `npm run test -- src/modules/auth/auth.service.spec.ts`

- [x] **Step 5: Commit**

```bash
git add src/modules/auth/ src/mail/
git commit -m "feat(auth): add password reset service logic and mail template"
```

---

### Task 2: Auth Controller Endpoints & E2E Tests for Password Reset

**Files:**
- Modify: `src/modules/auth/auth.controller.ts`
- Test: `test/forgot-reset-password.e2e-spec.ts`

- [x] **Step 1: Add Controller Routes**

Add `@Public() @Post('forgot-password')` and `@Public() @Post('reset-password')` to `AuthController` with OpenAPI `@ApiOperation`, `@ResponseMessage`, and `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.

- [x] **Step 2: Write E2E Test Suite**

Create `test/forgot-reset-password.e2e-spec.ts` testing successful reset, invalid token, expired token, rate limits, and refresh token revocation after reset.

- [x] **Step 3: Run E2E Tests**

Run: `NODE_OPTIONS=--experimental-vm-modules jest test/forgot-reset-password.e2e-spec.ts --runInBand`

- [x] **Step 4: Commit**

```bash
git add src/modules/auth/auth.controller.ts test/forgot-reset-password.e2e-spec.ts
git commit -m "feat(auth): expose forgot-password and reset-password endpoints with e2e tests"
```

---

### Task 3: BullMQ Webhook Alerting, Graceful Shutdown, & Security Headers

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `src/mail/mail.processor.ts`
- Modify: `src/redis/redis.module.ts`
- Modify: `src/main.ts`
- Test: `src/mail/mail.processor.spec.ts`

- [x] **Step 1: Add `ALERT_WEBHOOK_URL` to Env Schema**

Update `Env` class in `env.validation.ts` with optional `ALERT_WEBHOOK_URL` URL string validator.

- [x] **Step 2: Webhook Alert on Job Failure**

In `MailProcessor` `@OnWorkerEvent('failed')`, when max attempts exhausted (`job.attemptsMade >= job.opts.attempts`), send POST payload via `fetch(webhookUrl)` if `ALERT_WEBHOOK_URL` is set.
Add unit test verifying fetch call when max attempts reached.

- [x] **Step 3: Graceful Shutdown Lifecycle Hooks**

Implement `OnModuleDestroy` on `RedisModule` (or `RedisService`) to invoke `redis.quit()`, and on `MailProcessor` worker instance.

- [x] **Step 4: Helmet CSP Adjustments in `main.ts`**

Configure `helmet()` in `main.ts` with CSP options permitting Swagger UI when non-production.

- [x] **Step 5: Run Full Verification Pipeline**

Run: `npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e`

- [x] **Step 6: Commit**

```bash
git add src/ docs/
git commit -m "feat(infra): add webhook alerting, graceful shutdown, and updated helmet config"
```
