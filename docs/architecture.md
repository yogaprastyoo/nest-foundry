# Architecture & System Design

This document details the software architecture, system boundaries, component communication, and key architectural decisions for `nest-foundry`.

## 1. Request Lifecycle

The lifecycle of an HTTP request through `nest-foundry` flows through standard NestJS middleware, guards, pipes, controllers, services, and interceptors/filters.

```
Client Request
      │
      ▼
┌───────────────────────────┐
│     ThrottlerGuard        │ ◄── Rate limiting per IP/Route (`src/app.module.ts:40`)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│      JwtAuthGuard         │ ◄── Validates JWT Access Token unless `@Public()` applied (`src/common/guards/jwt-auth.guard.ts:25`)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│     ValidationPipe        │ ◄── Custom pipe validation with `CONSTRAINT_PRIORITY` (`src/common/pipes/validation.pipe-factory.ts:10`)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│    Controller Handler     │ ◄── Route handling, extracts params/DTOs (`src/modules/auth/auth.controller.ts:42`)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│      Domain Service       │ ◄── Business logic execution (`src/modules/auth/auth.service.ts:35`)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│      PrismaService        │ ◄── Database queries (with default password omit) (`src/prisma/prisma.service.ts:12`)
└─────────────┬─────────────┘
              │
              ├───────────────────────────────┐
              ▼ (Success Return)              ▼ (Unhandled Exception)
┌───────────────────────────┐   ┌───────────────────────────┐
│   TransformInterceptor    │   │   AllExceptionsFilter     │
│  (Formats success envelope│   │ (Formats error envelope   │
│   with `@ResponseMessage`)│   │  with error response DTO) │
│ (`src/common/interceptors/│   │ (`src/common/filters/     │
│  transform.interceptor.ts`)│   │  all-exceptions.filter.ts`)│
└─────────────┬─────────────┘   └─────────────┬─────────────┘
              │                               │
              └───────────────┬───────────────┘
                              │
                              ▼
                        Client Response
```

### Response Envelope & OAuth Exception Route

Standard endpoints process returned raw data and wrap responses in a standard JSON envelope:

| Envelope Type | Structural Pattern | Primary Handler | Location Reference |
| :--- | :--- | :--- | :--- |
| **Success Response** | `{ "success": true, "message": "...", "data": { ... } }` | `TransformInterceptor` | `src/common/interceptors/transform.interceptor.ts:16` |
| **Error Response** | `{ "success": false, "message": "...", "errors": null }` | `AllExceptionsFilter` | `src/common/filters/all-exceptions.filter.ts:20` |

#### The OAuth Redirect Bypass Exception

The Google OAuth callback endpoint (`GET /api/v1/auth/google/callback` in `src/modules/auth/auth.controller.ts:79`) explicitly bypasses the standard JSON response envelope by executing an HTTP 302 redirect via `res.redirect()` (`src/modules/auth/auth.controller.ts:98`).

- **Rationale:** HTTP 302 redirects transfer browser navigation context back to the frontend application URL with a authorization code parameter. Because an HTTP 302 redirect has no response body, skipping the JSON envelope is an intentional protocol requirement rather than an envelope violation or unhandled endpoint.

---

## 2. Module Map & Responsibilities

The codebase is organized as a modular monolith where each module encapsulates a domain capability.

| Module | Core Responsibility | Exports / Shared Interface | Dependencies | Location Reference |
| :--- | :--- | :--- | :--- | :--- |
| `UsersModule` | Canonical domain module. Manages user entities, password-omitted queries, profile management. | `UsersService` | `PrismaModule` | `src/modules/users/users.module.ts:1` |
| `AuthModule` | Authentication lifecycle (JWT, Argon2, Refresh Tokens, Verification, OAuth). | `AuthService` | `UsersModule`, `HashingModule`, `MailModule`, `RedisModule` | `src/modules/auth/auth.module.ts:1` |
| `PrismaModule` | Extended Prisma client instance with default password omission. | `PrismaService` | None | `src/prisma/prisma.module.ts:1` |
| `RedisModule` | IORedis client wrapper for token storage, rate-limiting, and locks. | `REDIS_CLIENT` token | None | `src/redis/redis.module.ts:1` |
| `QueueModule` | BullMQ connection wrapper and queue registration. | BullMQ queues | `RedisModule` | `src/queue/queue.module.ts:1` |
| `MailModule` | Email queuing, rendering, and delivery processing. | `MailQueue` | `QueueModule` | `src/mail/mail.module.ts:1` |
| `HealthModule` | Application status checks and dependency readiness endpoints. | None | `PrismaModule`, `RedisModule` | `src/modules/health/health.module.ts:1` |

### Canonical Module Model: `UsersModule`

`UsersModule` serves as the project's reference module template:
- Single responsibility boundary over user data access (`src/modules/users/users.service.ts:1`).
- Explicit wrapper methods (`findByEmailWithPassword`, `findByIdWithPassword`) to handle password hash access safely.
- Isolated DTO models and mapping helpers (`user-response.dto.ts`).

---

## 3. Distributed State Strategy (Redis)

Redis manages ephemeral application state across horizontal application nodes.

```
                  ┌───────────────────────────────────┐
                  │          Redis Storage            │
                  └─────────────────┬─────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
┌──────────────┐             ┌──────────────┐             ┌──────────────┐
│  Throttler   │             │   Lockout    │             │   Refresh    │
│   Storage    │             │   Counters   │             │ Tokens/Revoke│
└──────────────┘             └──────────────┘             └──────────────┘
```

| State Category | Redis Key Pattern | TTL / Retention | Behavior & Purpose | Location Reference |
| :--- | :--- | :--- | :--- | :--- |
| **Rate Limiting** | `throttler:{ip}` | Configured window | Distributed tracking for `ThrottlerGuard` across app replicas. | `src/common/throttler/redis-throttler-storage.service.ts:15` |
| **Account Lockout** | `auth:lockout:{email}` | 15 minutes | Tracks failed login attempts (10 fails trigger lockouts). | `src/modules/auth/password.constants.ts:5` |
| **Resend Cooldown** | `auth:resend:{email}` | 60 seconds | Cooldown guard to prevent verification email spam. | `src/modules/auth/verification.constants.ts:3` |
| **Resend Quota** | `auth:resend:quota:{email}`| 1 hour | Limits resends to max 5/hour per target email. | `src/modules/auth/verification.constants.ts:4` |

### Multi-Instance Deployment Implication

Because throttling, lockout counters, and token revocations reside in Redis, running multiple application containers (`node dist/main`) behind a load balancer maintains complete state consistency without sticky sessions.

---

## 4. Complete Authentication Lifecycle Flow

```
Register -> Verify Email -> Login -> Refresh Token Rotation -> Reuse Detection -> Revoke
```

```
User               Client                API / Auth               Redis / DB
 │                   │                       │                        │
 │── Register ──────►│── POST /register ────►│── Create User (Unverified)
 │                   │                       │── Enqueue Verify Email │
 │                   │                       │                        │
 │── Verify Email ──►│── POST /verify-email ─►│── Set Email Verified   │
 │                   │                       │                        │
 │── Login ─────────►│── POST /login ────────►│── Validate Argon2 Hash │
 │                   │                       │── Issue Access Token   │
 │                   │                       │── Issue Refresh Token ─► Store Hash in DB
 │                   │                       │   (Set HttpOnly Cookie)│
 │                   │                       │                        │
 │                   │── POST /refresh ─────►│── Check Refresh Token  │
 │                   │                       │   Rotate Token ────────► Transaction Swap
 │                   │                       │                        │
 │                   │ (Compromised Token)   │                        │
 │                   │── POST /refresh ─────►│── Detect Reused Token! │
 │                   │                       │── Revoke ALL User Sessions ──► Delete All User Tokens
```

1. **Registration:** `AuthService.register()` persists user with `emailVerified: false` (`src/modules/auth/auth.service.ts:35`), enqueues verification email job (`src/mail/mail.processor.ts:20`).
2. **Verification:** Token verified atomically via `$transaction` (`src/modules/auth/verification.service.ts:30`), token deleted on consumption (`count === 1` check).
3. **Login:** Validate password against Argon2 hash (`src/modules/auth/password.service.ts:55`). Generate Access Token (JWT 15m) + Refresh Token (7d stored as SHA-256 in database) (`src/modules/auth/token.service.ts:20`). Set HttpOnly cookie (`src/modules/auth/interceptors/set-refresh-cookie.interceptor.ts:15`).
4. **Refresh Rotation & Reuse Detection:** Executed inside atomic database transaction (`src/modules/auth/token.service.ts:60`). If an old/used refresh token is presented, trigger security breach response: **revoke all refresh tokens belonging to the user** (`src/modules/auth/token.service.ts:95`).

---

## 5. Background Jobs & Resilience (BullMQ)

`MailModule` utilizes BullMQ backed by Redis for asynchronous email processing.

| Queue Name | Job Name | Processor Location | Dead-Letter Visibility |
| :--- | :--- | :--- | :--- |
| `mail-queue` | `send-verification-email` | `src/mail/mail.processor.ts:25` | Application Dead-Letter Log (`src/mail/mail.processor.ts:50`) |
| `mail-queue` | `send-password-reset-email` | `src/mail/mail.processor.ts:35` | Application Dead-Letter Log (`src/mail/mail.processor.ts:50`) |

### Two-Layer Job Idempotency

1. **BullMQ Job ID Layer:** Deduplication via strict `jobId` formatting (`mail:verify:{userId}:{tokenHash}`). BullMQ rejects duplicate active jobs with identical IDs (`src/mail/mail.queue.ts:20`).
2. **Database State Guard Layer:** Processor validates entity state before sending (`user.emailVerified === false`). If already verified, job terminates safely without sending (`src/mail/mail.processor.ts:30`).

### Dead-Letter Visibility

When job retries exhaust, BullMQ routes failed jobs to the failed set. The processor catches final failure events and emits formatted application logs via Pino (`src/mail/mail.processor.ts:50`).

*Note:* This starter provides application-level log visibility only. External alerting integration (Sentry, Slack webhook, Datadog) is marked as [RENCANA].

---

## 6. Architectural Decision Records (ADRs)

| Decision | Choice | Rationale & Alternatives Considered |
| :--- | :--- | :--- |
| **Architecture Pattern** | Modular Monolith | Keeps deployment simple for starter template while maintaining strong boundary isolation per module. Microservices rejected due to overhead for core auth starter tasks. |
| **Tenancy Model** | Single-Tenant | Avoids multi-tenant complexity (schema-per-tenant or tenant_id row filtering) in baseline boilerplate. Multi-tenancy can be layered on top via standard schema migrations. |
| **Password Omitting** | Extension-Level Prisma Omit | Password field omitted globally at database layer to prevent inadvertent leaks in API responses. Explicit methods required to pull password hashes. |
