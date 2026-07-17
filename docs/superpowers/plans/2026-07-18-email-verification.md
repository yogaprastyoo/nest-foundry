# Email Verification (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in email verification: on register (when the toggle is on) issue a single-use verification token and send an async email; expose `POST /auth/verify-email` and `POST /auth/resend-verification`, with production-grade security fundamentals.

**Architecture:** A driver-based `MailService` (log/resend, chosen by env) is fed by a BullMQ `mail` queue whose processor sends the email. A `VerificationService` in the auth module issues tokens (256-bit CSPRNG, stored only as SHA-256, single-active per type, atomic single-use consume) and orchestrates sending via a thin `MailQueue` producer. `AuthService.register` enqueues verification when `AUTH_REQUIRE_EMAIL_VERIFICATION=true`; login already rejects unverified users (Plan 2).

**Tech Stack:** NestJS 11, Prisma 7 (+`@prisma/adapter-pg`), BullMQ + `@nestjs/bullmq` (Redis), `resend`, ioredis, Zod env validation, Jest + supertest.

## Global Constraints

- **English-first:** every user-facing string (API messages, validation, Swagger, email copy) MUST be English.
- **No Claude co-author** in any commit/PR trailer.
- **Response envelope:** success `{ success, message, data }`; error `{ success: false, message, errors }`. Controllers return raw data + `@ResponseMessage('...')`; the global `TransformInterceptor`/`AllExceptionsFilter` wrap it.
- **Validation messages:** use `ValidationMessage` helper (`src/common/validation/validation-message.ts`); rule priority is enforced in `flatten()` (`src/common/pipes/validation.pipe-factory.ts`).
- **Prisma client is ESM-generated:** never `instanceof PrismaClientKnownRequestError` — duck-type by `error.code`/`error.name`. Specs importing services that pull `PrismaService` must `jest.mock('../../prisma/prisma.service')` (manual mock at `src/prisma/__mocks__/prisma.service.ts` — extend it as new models are used).
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Secrets never logged:** raw tokens/URLs must never reach logs except the dev-only `log` mail driver. pino redaction already covers auth/cookie/set-cookie headers.
- **Config typing:** read env via `ConfigService<Env, true>` with `{ infer: true }`.
- **Docker services** (postgres `docker-postgres-1`, redis `docker-redis-1`) must be up for e2e: `docker start docker-postgres-1 docker-redis-1`.

---

## File Structure

**Create:**
- `src/common/crypto/token.util.ts` — `generateToken()` (256-bit base64url), `sha256(value)`.
- `src/mail/mail.constants.ts` — `MAIL_DRIVER_TOKEN`, driver names.
- `src/mail/drivers/mail-driver.interface.ts` — `MailDriver` interface + `MailMessage` type.
- `src/mail/drivers/log-mail.driver.ts` — prints message (dev).
- `src/mail/drivers/resend-mail.driver.ts` — sends via Resend API.
- `src/mail/templates/verification-email.template.ts` — builds subject/html/text; HTML-escapes name.
- `src/mail/mail.service.ts` — `sendVerificationEmail(...)`; delegates to the active driver.
- `src/mail/mail.module.ts` — provides the driver (factory by `MAIL_DRIVER`) + `MailService`.
- `src/queue/queue.constants.ts` — `MAIL_QUEUE = 'mail'`, `VERIFICATION_EMAIL_JOB = 'verification-email'`.
- `src/queue/queue.module.ts` — `BullModule.forRootAsync` (Redis) + `registerQueue({ name: MAIL_QUEUE })`; re-exports registration.
- `src/mail/mail.queue.ts` — `MailQueue` producer: `enqueueVerificationEmail(job)`.
- `src/mail/mail.processor.ts` — `@Processor(MAIL_QUEUE)` worker → `MailService`.
- `src/modules/auth/verification.constants.ts` — cooldown key + seconds.
- `src/modules/auth/verification.service.ts` — issue/send/verify/resend.
- `src/modules/auth/dto/verify-email.dto.ts`, `src/modules/auth/dto/resend-verification.dto.ts`.

**Modify:**
- `prisma/schema.prisma` — `TokenType` enum + `VerificationToken` model + `User.verificationTokens` relation.
- `src/config/env.validation.ts` — new mail/frontend/ttl vars + conditional refines.
- `.env.example` — new vars with comments.
- `src/prisma/__mocks__/prisma.service.ts` — add `verificationToken` + `$transaction`.
- `src/modules/auth/auth.service.ts` — enqueue verification on register (toggle on, non-fatal).
- `src/modules/auth/auth.controller.ts` — `verify-email` + `resend-verification` endpoints.
- `src/modules/auth/auth.module.ts` — import `MailModule` (+ queue registration), add `VerificationService`.
- `src/app.module.ts` — import `QueueModule` + `MailModule`.

---

### Task 1: Prisma schema — VerificationToken

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated>_add_verification_token/migration.sql` (via CLI)

**Interfaces:**
- Produces: Prisma model `VerificationToken { id, userId, tokenHash, type: TokenType, expiresAt, createdAt }`; enum `TokenType { EMAIL_VERIFICATION, PASSWORD_RESET }`; generated types importable from `../generated/prisma/client`.

- [ ] **Step 1: Add enum + model + relation to `prisma/schema.prisma`**

Add after the `Role` enum:
```prisma
enum TokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}
```
Add relation field inside `model User { ... }` (after `refreshTokens`):
```prisma
  verificationTokens VerificationToken[]
```
Add model after `RefreshToken`:
```prisma
model VerificationToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  type      TokenType
  expiresAt DateTime
  createdAt DateTime  @default(now())

  @@index([userId, type])
  @@map("verification_tokens")
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `docker start docker-postgres-1 docker-redis-1 && npx prisma migrate dev --name add_verification_token`
Expected: migration created under `prisma/migrations/`, applied, and `prisma generate` runs (client regenerated with `VerificationToken`, `TokenType`).

- [ ] **Step 3: Verify generated types exist**

Run: `grep -R "TokenType" src/generated/prisma/enums.ts`
Expected: `export const TokenType = { EMAIL_VERIFICATION: ..., PASSWORD_RESET: ... }`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat: add VerificationToken model and TokenType enum"
```

---

### Task 2: Env validation for mail + frontend

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/env.validation.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `Env` gains `MAIL_DRIVER: 'log' | 'resend'`, `MAIL_FROM: string`, `RESEND_API_KEY: string`, `FRONTEND_URL: string`, `EMAIL_VERIFICATION_TTL: number`. Boot fails if `NODE_ENV=production` with `MAIL_DRIVER=log`, or `MAIL_DRIVER=resend` without `RESEND_API_KEY`.

- [ ] **Step 1: Write failing tests in `src/config/env.validation.spec.ts`**

Add inside `describe('validateEnv', ...)`:
```typescript
it('defaults MAIL_DRIVER to log and EMAIL_VERIFICATION_TTL to 86400', () => {
  const env = validateEnv(validEnv);
  expect(env.MAIL_DRIVER).toBe('log');
  expect(env.EMAIL_VERIFICATION_TTL).toBe(86400);
});

it('rejects MAIL_DRIVER=log in production', () => {
  expect(() =>
    validateEnv({ ...validEnv, NODE_ENV: 'production', MAIL_DRIVER: 'log' }),
  ).toThrow(/MAIL_DRIVER/);
});

it('requires RESEND_API_KEY when MAIL_DRIVER=resend', () => {
  expect(() =>
    validateEnv({ ...validEnv, MAIL_DRIVER: 'resend', RESEND_API_KEY: '' }),
  ).toThrow(/RESEND_API_KEY/);
});

it('rejects an invalid FRONTEND_URL', () => {
  expect(() =>
    validateEnv({ ...validEnv, FRONTEND_URL: 'not-a-url' }),
  ).toThrow(/FRONTEND_URL/);
});
```
Note: production also requires JWT secrets ≥32 chars — `validEnv` already satisfies that.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/config/env.validation.spec.ts -t MAIL_DRIVER -v`
Expected: FAIL (fields undefined / no such rule).

- [ ] **Step 3: Add fields + refines in `src/config/env.validation.ts`**

Add these keys inside the `.object({ ... })` (before the closing `})`):
```typescript
    MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
    MAIL_FROM: z.string().min(1).default('Loopwork <noreply@example.com>'),
    RESEND_API_KEY: z.string().default(''),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    EMAIL_VERIFICATION_TTL: z.coerce
      .number()
      .int()
      .positive()
      .default(86400),
```
Add two `.refine(...)` after the existing secrets refine (chain them):
```typescript
  .refine(
    (env) => !(env.NODE_ENV === 'production' && env.MAIL_DRIVER === 'log'),
    {
      message: "MAIL_DRIVER must not be 'log' in production",
      path: ['MAIL_DRIVER'],
    },
  )
  .refine((env) => !(env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY), {
    message: 'RESEND_API_KEY is required when MAIL_DRIVER=resend',
    path: ['RESEND_API_KEY'],
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/config/env.validation.spec.ts -v`
Expected: PASS (all).

- [ ] **Step 5: Update `.env.example`**

Append:
```dotenv

# Mail
MAIL_DRIVER=log                         # log | resend (must be 'resend' in production)
MAIL_FROM="Loopwork <noreply@example.com>"
RESEND_API_KEY=                         # required only when MAIL_DRIVER=resend
FRONTEND_URL=http://localhost:5173      # base URL for links in emails
EMAIL_VERIFICATION_TTL=86400            # seconds (24 hours)
```

- [ ] **Step 6: Commit**

```bash
git add src/config/env.validation.ts src/config/env.validation.spec.ts .env.example
git commit -m "feat: add mail/frontend env config with production-safety refines"
```

---

### Task 3: Crypto token utility

**Files:**
- Create: `src/common/crypto/token.util.ts`
- Create: `src/common/crypto/token.util.spec.ts`

**Interfaces:**
- Produces: `generateToken(): string` (43-char base64url from 32 random bytes); `sha256(value: string): string` (64-char hex).

- [ ] **Step 1: Write failing test `src/common/crypto/token.util.spec.ts`**

```typescript
import { generateToken, sha256 } from './token.util';

describe('token.util', () => {
  it('generateToken returns a URL-safe 256-bit token', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(t.length).toBe(43); // 32 bytes base64url
    expect(generateToken()).not.toEqual(t); // random
  });

  it('sha256 is deterministic 64-char hex', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/common/crypto/token.util.spec.ts -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/common/crypto/token.util.ts`**

```typescript
import { createHash, randomBytes } from 'node:crypto';

/** 256-bit CSPRNG token, base64url-encoded (URL-safe, no padding). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — used to store/look up tokens without keeping the raw value. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/common/crypto/token.util.spec.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/common/crypto/token.util.ts src/common/crypto/token.util.spec.ts
git commit -m "feat: add CSPRNG token + sha256 crypto util"
```

---

### Task 4: Mail drivers, template, and MailService

**Files:**
- Create: `src/mail/drivers/mail-driver.interface.ts`
- Create: `src/mail/mail.constants.ts`
- Create: `src/mail/templates/verification-email.template.ts`
- Create: `src/mail/templates/verification-email.template.spec.ts`
- Create: `src/mail/drivers/log-mail.driver.ts`
- Create: `src/mail/drivers/resend-mail.driver.ts`
- Create: `src/mail/mail.service.ts`
- Create: `src/mail/mail.service.spec.ts`

**Interfaces:**
- Produces:
  - `interface MailMessage { to: string; subject: string; html: string; text: string }`
  - `interface MailDriver { send(message: MailMessage): Promise<void> }`
  - `const MAIL_DRIVER = 'MAIL_DRIVER'` (DI token)
  - `buildVerificationEmail(input: { name: string; url: string }): { subject: string; html: string; text: string }`
  - `MailService.sendVerificationEmail(input: { to: string; name: string; url: string }): Promise<void>`
- Consumes: `Env.MAIL_FROM`, `resend` package (Task installs it).

- [ ] **Step 1: Install dependencies**

Run: `npm install resend`
Expected: `resend` added to dependencies.

- [ ] **Step 2: Create the interface + constants**

`src/mail/mail.constants.ts`:
```typescript
export const MAIL_DRIVER = 'MAIL_DRIVER';
```
`src/mail/drivers/mail-driver.interface.ts`:
```typescript
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailDriver {
  send(message: MailMessage): Promise<void>;
}
```

- [ ] **Step 3: Write failing template test `src/mail/templates/verification-email.template.spec.ts`**

```typescript
import { buildVerificationEmail } from './verification-email.template';

describe('buildVerificationEmail', () => {
  it('includes the URL and escapes the name in HTML', () => {
    const out = buildVerificationEmail({
      name: '<script>alert(1)</script>',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(out.subject).toMatch(/verify/i);
    expect(out.html).toContain('https://app.test/verify-email?token=abc');
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.text).toContain('https://app.test/verify-email?token=abc');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest src/mail/templates/verification-email.template.spec.ts -v`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/mail/templates/verification-email.template.ts`**

```typescript
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVerificationEmail(input: { name: string; url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(input.name);
  const url = input.url; // server-built from config, safe in href
  return {
    subject: 'Verify your email address',
    html: `<p>Hi ${name},</p>
<p>Please verify your email address by clicking the link below:</p>
<p><a href="${url}">Verify my email</a></p>
<p>If you did not create an account, you can ignore this email.</p>`,
    text: `Hi ${input.name},

Please verify your email address by opening this link:
${url}

If you did not create an account, you can ignore this email.`,
  };
}
```

- [ ] **Step 6: Run template test to verify it passes**

Run: `npx jest src/mail/templates/verification-email.template.spec.ts -v`
Expected: PASS.

- [ ] **Step 7: Implement the drivers**

`src/mail/drivers/log-mail.driver.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { MailDriver, MailMessage } from './mail-driver.interface';

/** Dev/test driver: logs the message (incl. links) instead of sending. Never use in production. */
@Injectable()
export class LogMailDriver implements MailDriver {
  private readonly logger = new Logger('MailLog');

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `Email to ${message.to} | ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}
```
`src/mail/drivers/resend-mail.driver.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Env } from '../../config/env.validation';
import { MailDriver, MailMessage } from './mail-driver.interface';

@Injectable()
export class ResendMailDriver implements MailDriver {
  private readonly client: Resend;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Resend(config.get('RESEND_API_KEY', { infer: true }));
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      throw new Error(`Resend failed: ${error.message}`);
    }
  }
}
```

- [ ] **Step 8: Write failing `MailService` test `src/mail/mail.service.spec.ts`**

```typescript
import { MailService } from './mail.service';
import { MailDriver, MailMessage } from './drivers/mail-driver.interface';

describe('MailService', () => {
  it('sends a verification email via the active driver', async () => {
    const sent: MailMessage[] = [];
    const driver: MailDriver = {
      send: (m) => {
        sent.push(m);
        return Promise.resolve();
      },
    };
    const service = new MailService(driver);
    await service.sendVerificationEmail({
      to: 'a@b.c',
      name: 'Budi',
      url: 'https://app.test/verify-email?token=abc',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@b.c');
    expect(sent[0].html).toContain('token=abc');
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npx jest src/mail/mail.service.spec.ts -v`
Expected: FAIL (module not found).

- [ ] **Step 10: Implement `src/mail/mail.service.ts`**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { MAIL_DRIVER } from './mail.constants';
import { MailDriver } from './drivers/mail-driver.interface';
import { buildVerificationEmail } from './templates/verification-email.template';

@Injectable()
export class MailService {
  constructor(@Inject(MAIL_DRIVER) private readonly driver: MailDriver) {}

  async sendVerificationEmail(input: {
    to: string;
    name: string;
    url: string;
  }): Promise<void> {
    const { subject, html, text } = buildVerificationEmail({
      name: input.name,
      url: input.url,
    });
    await this.driver.send({ to: input.to, subject, html, text });
  }
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npx jest src/mail/mail.service.spec.ts src/mail/templates -v`
Expected: PASS.

- [ ] **Step 12: Create `src/mail/mail.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { MAIL_DRIVER } from './mail.constants';
import { MailDriver } from './drivers/mail-driver.interface';
import { LogMailDriver } from './drivers/log-mail.driver';
import { ResendMailDriver } from './drivers/resend-mail.driver';
import { MailService } from './mail.service';

@Module({
  providers: [
    {
      provide: MAIL_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailDriver =>
        config.get('MAIL_DRIVER', { infer: true }) === 'resend'
          ? new ResendMailDriver(config)
          : new LogMailDriver(),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
```

- [ ] **Step 13: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no output.
```bash
git add src/mail package.json package-lock.json
git commit -m "feat: add MailService with log/resend drivers and verification template"
```

---

### Task 5: Queue module, MailQueue producer, MailProcessor

**Files:**
- Create: `src/queue/queue.constants.ts`
- Create: `src/queue/queue.module.ts`
- Create: `src/mail/mail.queue.ts`
- Create: `src/mail/mail.processor.ts`
- Create: `src/mail/mail.processor.spec.ts`
- Modify: `src/mail/mail.module.ts` (add `MailQueue` + `MailProcessor`, import queue registration)

**Interfaces:**
- Produces:
  - `const MAIL_QUEUE = 'mail'`, `const VERIFICATION_EMAIL_JOB = 'verification-email'`
  - `interface VerificationEmailJob { to: string; name: string; url: string }`
  - `MailQueue.enqueueVerificationEmail(job: VerificationEmailJob): Promise<void>`
- Consumes: `Env.REDIS_HOST`, `Env.REDIS_PORT`, `MailService` (Task 4).

- [ ] **Step 1: Install dependencies**

Run: `npm install @nestjs/bullmq bullmq`
Expected: both added to dependencies.

- [ ] **Step 2: Create `src/queue/queue.constants.ts`**

```typescript
export const MAIL_QUEUE = 'mail';
export const VERIFICATION_EMAIL_JOB = 'verification-email';

export interface VerificationEmailJob {
  to: string;
  name: string;
  url: string;
}
```

- [ ] **Step 3: Create `src/queue/queue.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { MAIL_QUEUE } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
        },
      }),
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

- [ ] **Step 4: Create `src/mail/mail.queue.ts`**

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  MAIL_QUEUE,
  VERIFICATION_EMAIL_JOB,
  VerificationEmailJob,
} from '../queue/queue.constants';

@Injectable()
export class MailQueue {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  async enqueueVerificationEmail(job: VerificationEmailJob): Promise<void> {
    await this.queue.add(VERIFICATION_EMAIL_JOB, job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
```

- [ ] **Step 5: Write failing processor test `src/mail/mail.processor.spec.ts`**

```typescript
import { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { VERIFICATION_EMAIL_JOB } from '../queue/queue.constants';

describe('MailProcessor', () => {
  it('routes a verification-email job to MailService.sendVerificationEmail', async () => {
    const mail = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;
    const processor = new MailProcessor(mail);
    const job = {
      name: VERIFICATION_EMAIL_JOB,
      data: { to: 'a@b.c', name: 'Budi', url: 'https://x/verify?token=t' },
    } as Job;

    await processor.process(job);

    expect(mail.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'a@b.c',
      name: 'Budi',
      url: 'https://x/verify?token=t',
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest src/mail/mail.processor.spec.ts -v`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `src/mail/mail.processor.ts`**

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  MAIL_QUEUE,
  VERIFICATION_EMAIL_JOB,
  VerificationEmailJob,
} from '../queue/queue.constants';
import { MailService } from './mail.service';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === VERIFICATION_EMAIL_JOB) {
      const data = job.data as VerificationEmailJob;
      await this.mail.sendVerificationEmail(data);
    }
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest src/mail/mail.processor.spec.ts -v`
Expected: PASS.

- [ ] **Step 9: Wire `MailQueue` + `MailProcessor` into `src/mail/mail.module.ts`**

Add imports and register the queue + providers:
```typescript
import { BullModule } from '@nestjs/bullmq';
import { MAIL_QUEUE } from '../queue/queue.constants';
import { MailQueue } from './mail.queue';
import { MailProcessor } from './mail.processor';
```
Update the `@Module` decorator:
```typescript
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [
    /* existing MAIL_DRIVER factory + MailService */
    MailQueue,
    MailProcessor,
  ],
  exports: [MailService, MailQueue],
})
```
(Keep the existing `MAIL_DRIVER` factory and `MailService` provider entries.)

- [ ] **Step 10: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no output.
```bash
git add src/queue src/mail package.json package-lock.json
git commit -m "feat: add BullMQ mail queue, producer, and processor"
```

---

### Task 6: VerificationService

**Files:**
- Create: `src/modules/auth/verification.constants.ts`
- Create: `src/modules/auth/verification.service.ts`
- Create: `src/modules/auth/verification.service.spec.ts`
- Modify: `src/prisma/__mocks__/prisma.service.ts` (add `verificationToken` + `$transaction`)

**Interfaces:**
- Consumes: `generateToken`, `sha256` (Task 3); `MailQueue.enqueueVerificationEmail` (Task 5); `UsersService.findByEmail` (Plan 2); `PrismaService`; `REDIS_CLIENT`; `ConfigService<Env,true>`; `TokenType` from generated client.
- Produces:
  - `VerificationService.sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<void>`
  - `VerificationService.verifyEmail(rawToken: string): Promise<void>` (throws `BadRequestException('Invalid or expired verification token.')` on any failure)
  - `VerificationService.resendVerification(rawEmail: string): Promise<void>` (always resolves; uniform)

- [ ] **Step 1: Create `src/modules/auth/verification.constants.ts`**

```typescript
export const RESEND_COOLDOWN_SECONDS = 60;
export const resendCooldownKey = (email: string): string =>
  `verify:cooldown:${email}`;
```

- [ ] **Step 2: Extend `src/prisma/__mocks__/prisma.service.ts`**

```typescript
export class PrismaService {
  user = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  verificationToken = {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  };
  $transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(this));
}
```

- [ ] **Step 3: Write failing tests `src/modules/auth/verification.service.spec.ts`**

```typescript
import { BadRequestException } from '@nestjs/common';
import { TokenType } from '../../generated/prisma/client';
import { VerificationService } from './verification.service';
import { sha256 } from '../../common/crypto/token.util';

jest.mock('../../prisma/prisma.service');

type Mocked = {
  prisma: {
    verificationToken: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
    };
    user: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  users: { findByEmail: jest.Mock };
  mailQueue: { enqueueVerificationEmail: jest.Mock };
  redis: { set: jest.Mock };
  config: { get: jest.Mock };
};

function build(): { service: VerificationService } & Mocked {
  const prisma = {
    verificationToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const users = { findByEmail: jest.fn() };
  const mailQueue = { enqueueVerificationEmail: jest.fn() };
  const redis = { set: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_URL'
        ? 'https://app.test'
        : key === 'EMAIL_VERIFICATION_TTL'
          ? 86400
          : undefined,
    ),
  };
  const service = new VerificationService(
    prisma as never,
    users as never,
    mailQueue as never,
    redis as never,
    config as never,
  );
  return { service, prisma, users, mailQueue, redis, config };
}

describe('VerificationService', () => {
  it('sendVerificationEmail issues a single-active token and enqueues a URL', async () => {
    const { service, prisma, mailQueue } = build();
    await service.sendVerificationEmail({
      id: 'u1',
      email: 'a@b.c',
      name: 'Budi',
    });
    // single-active: deletes old same-type tokens, then creates
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: TokenType.EMAIL_VERIFICATION },
    });
    expect(prisma.verificationToken.create).toHaveBeenCalled();
    const job = mailQueue.enqueueVerificationEmail.mock.calls[0][0];
    expect(job.to).toBe('a@b.c');
    expect(job.url).toMatch(
      /^https:\/\/app\.test\/verify-email\?token=[A-Za-z0-9_-]+$/,
    );
  });

  it('verifyEmail consumes the token atomically and marks the user verified', async () => {
    const { service, prisma } = build();
    const raw = 'sometoken';
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + 10_000),
    });
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });

    await service.verifyEmail(raw);

    expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256(raw) },
    });
    // atomic single-use: conditional delete by id, count checked
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { id: 't1' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isEmailVerified: true },
    });
  });

  it('verifyEmail rejects an unknown token uniformly', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue(null);
    await expect(service.verifyEmail('x')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('verifyEmail rejects an expired token', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(service.verifyEmail('x')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('verifyEmail rejects a token of the wrong type (cross-type reuse)', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.PASSWORD_RESET,
      expiresAt: new Date(Date.now() + 10_000),
    });
    await expect(service.verifyEmail('x')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('verifyEmail treats a lost single-use race (count 0) as invalid', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + 10_000),
    });
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.verifyEmail('x')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('resendVerification is silent within cooldown (SET NX fails)', async () => {
    const { service, redis, users } = build();
    redis.set.mockResolvedValue(null); // NX failed → still in cooldown
    await service.resendVerification('A@B.c');
    expect(redis.set).toHaveBeenCalledWith(
      'verify:cooldown:a@b.c',
      '1',
      'EX',
      60,
      'NX',
    );
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('resendVerification sends when eligible and user is unverified', async () => {
    const { service, redis, users, mailQueue } = build();
    redis.set.mockResolvedValue('OK');
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'Budi',
      isEmailVerified: false,
    });
    await service.resendVerification('a@b.c');
    expect(mailQueue.enqueueVerificationEmail).toHaveBeenCalled();
  });

  it('resendVerification does nothing (but does not throw) for unknown/verified email', async () => {
    const { service, redis, users, mailQueue } = build();
    redis.set.mockResolvedValue('OK');
    users.findByEmail.mockResolvedValue(null);
    await expect(service.resendVerification('a@b.c')).resolves.toBeUndefined();
    expect(mailQueue.enqueueVerificationEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx jest src/modules/auth/verification.service.spec.ts -v`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/modules/auth/verification.service.ts`**

```typescript
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TokenType } from '../../generated/prisma/client';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { generateToken, sha256 } from '../../common/crypto/token.util';
import { MailQueue } from '../../mail/mail.queue';
import { UsersService } from '../users/users.service';
import {
  RESEND_COOLDOWN_SECONDS,
  resendCooldownKey,
} from './verification.constants';

@Injectable()
export class VerificationService {
  private readonly auditLog = new Logger('AuthAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mailQueue: MailQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async sendVerificationEmail(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<void> {
    const rawToken = await this.issueToken(user.id);
    const base = this.config.get('FRONTEND_URL', { infer: true });
    const url = `${base}/verify-email?token=${rawToken}`;
    await this.mailQueue.enqueueVerificationEmail({
      to: user.email,
      name: user.name,
      url,
    });
    this.auditLog.log({ event: 'verification_email_sent', userId: user.id });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (
      !row ||
      row.type !== TokenType.EMAIL_VERIFICATION ||
      row.expiresAt < new Date()
    ) {
      this.auditLog.warn({ event: 'verification_token_invalid' });
      throw this.invalidToken();
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic single-use: only the request that deletes the row (count 1) wins.
      const { count } = await tx.verificationToken.deleteMany({
        where: { id: row.id },
      });
      if (count === 0) throw this.invalidToken();
      await tx.user.update({
        where: { id: row.userId },
        data: { isEmailVerified: true },
      });
    });
    this.auditLog.log({ event: 'email_verified', userId: row.userId });
  }

  async resendVerification(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    // Cooldown is set for ANY request (existing email or not) so a 429/skip
    // never reveals whether the email is registered. Silent within cooldown.
    const acquired = await this.redis.set(
      resendCooldownKey(email),
      '1',
      'EX',
      RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (!acquired) return;

    const user = await this.users.findByEmail(email);
    this.auditLog.log({ event: 'verification_resend_requested' });
    if (!user || user.isEmailVerified) return;
    await this.sendVerificationEmail({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  }

  private async issueToken(userId: string): Promise<string> {
    const rawToken = generateToken();
    const ttlSeconds = this.config.get('EMAIL_VERIFICATION_TTL', {
      infer: true,
    });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.$transaction(async (tx) => {
      // Single-active token: a new token invalidates prior same-type tokens.
      await tx.verificationToken.deleteMany({
        where: { userId, type: TokenType.EMAIL_VERIFICATION },
      });
      await tx.verificationToken.create({
        data: {
          userId,
          tokenHash: sha256(rawToken),
          type: TokenType.EMAIL_VERIFICATION,
          expiresAt,
        },
      });
    });
    return rawToken;
  }

  private invalidToken(): BadRequestException {
    return new BadRequestException('Invalid or expired verification token.');
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest src/modules/auth/verification.service.spec.ts -v`
Expected: PASS (all 9).

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/verification.service.ts src/modules/auth/verification.service.spec.ts src/modules/auth/verification.constants.ts src/prisma/__mocks__/prisma.service.ts
git commit -m "feat: add VerificationService (single-use tokens, silent-cooldown resend)"
```

---

### Task 7: Wire register + endpoints + module

**Files:**
- Create: `src/modules/auth/dto/verify-email.dto.ts`
- Create: `src/modules/auth/dto/resend-verification.dto.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `VerificationService` (Task 6), `MailModule`/`QueueModule` (Tasks 4-5).
- Produces: `POST /auth/verify-email` (body `{ token }`), `POST /auth/resend-verification` (body `{ email }`), and register-side effect that enqueues verification when the toggle is on.

- [ ] **Step 1: Create the DTOs**

`src/modules/auth/dto/verify-email.dto.ts`:
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Verification token from the email link' })
  @IsNotEmpty({ message: V.required('Token') })
  @IsString({ message: V.string('Token') })
  @MaxLength(200, { message: V.max('Token', 200) })
  token!: string;
}
```
`src/modules/auth/dto/resend-verification.dto.ts`:
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

export class ResendVerificationDto {
  @ApiProperty({ description: 'Email to resend the verification link to', example: 'user@example.com' })
  @NormalizeEmail()
  @IsNotEmpty({ message: V.required('Email') })
  @IsEmail({}, { message: V.email('Email') })
  email!: string;
}
```

- [ ] **Step 2: Write failing test in `src/modules/auth/auth.service.spec.ts` (register enqueues when toggle on)**

Add a test that injects a fake `VerificationService` and asserts `sendVerificationEmail` is called only when the toggle is on. Follow the existing `AuthService` spec setup (env object with `AUTH_REQUIRE_EMAIL_VERIFICATION`); add `verification = { sendVerificationEmail: jest.fn() }` to the constructor args and:
```typescript
it('register enqueues verification email when the toggle is on', async () => {
  env.AUTH_REQUIRE_EMAIL_VERIFICATION = true;
  users.createLocal.mockResolvedValue({
    id: 'u1', email: 'a@b.c', name: 'Budi', role: 'USER', isEmailVerified: false,
  });
  await service.register({ email: 'a@b.c', password: 'password123', name: 'Budi' });
  expect(verification.sendVerificationEmail).toHaveBeenCalledWith({
    id: 'u1', email: 'a@b.c', name: 'Budi',
  });
  env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
});

it('register does NOT enqueue verification when the toggle is off', async () => {
  users.createLocal.mockResolvedValue({
    id: 'u1', email: 'a@b.c', name: 'Budi', role: 'USER', isEmailVerified: true,
  });
  await service.register({ email: 'a@b.c', password: 'password123', name: 'Budi' });
  expect(verification.sendVerificationEmail).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/modules/auth/auth.service.spec.ts -t "enqueues verification" -v`
Expected: FAIL (constructor arity / method missing).

- [ ] **Step 4: Modify `src/modules/auth/auth.service.ts`**

Inject `VerificationService` and, in `register`, after the successful `createLocal`, enqueue when the toggle is on — non-fatal:
```typescript
      const user = await this.users.createLocal({ /* unchanged */ });
      if (requireVerification) {
        try {
          await this.verification.sendVerificationEmail({
            id: user.id,
            email: user.email,
            name: user.name,
          });
        } catch (err) {
          // Never fail registration if the email can't be enqueued (e.g. Redis
          // down); the user exists and can request a resend later.
          this.auditLog.warn({
            event: 'verification_enqueue_failed',
            userId: user.id,
          });
        }
      }
      return { /* unchanged RegisterResponseDto */ };
```
Add `private readonly verification: VerificationService` to the constructor (import it).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/modules/auth/auth.service.spec.ts -v`
Expected: PASS.

- [ ] **Step 6: Add endpoints to `src/modules/auth/auth.controller.ts`**

Import DTOs + `VerificationService`; inject `private readonly verification: VerificationService`. Add:
```typescript
  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify an email address with a token' })
  @ApiResponse({ status: 200, description: 'Email verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ResponseMessage('Email verified successfully.')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<null> {
    await this.verification.verifyEmail(dto.token);
    return null;
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend the email verification link' })
  @ApiResponse({ status: 200, description: 'Verification email sent if the account is eligible' })
  @ResponseMessage('If the email is registered, a verification link has been sent.')
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<null> {
    await this.verification.resendVerification(dto.email);
    return null;
  }
```

- [ ] **Step 7: Wire modules**

`src/modules/auth/auth.module.ts`: import `MailModule`; add `VerificationService` to providers:
```typescript
import { MailModule } from '../../mail/mail.module';
// imports: [PassportModule, JwtModule.register({}), UsersModule, MailModule]
// providers: [..., VerificationService]
```
`src/app.module.ts`: add `QueueModule` and `MailModule` to `imports` (QueueModule is `@Global`, so BullMQ root config loads once):
```typescript
import { QueueModule } from './queue/queue.module';
import { MailModule } from './mail/mail.module';
// imports: [ ...existing, QueueModule, MailModule ]
```

- [ ] **Step 8: Typecheck, lint, unit tests**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -2 && npx jest --no-coverage 2>&1 | grep "Tests:"`
Expected: tsc clean, lint clean, all unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/modules/auth src/app.module.ts
git commit -m "feat: wire email verification into register and expose endpoints"
```

---

### Task 8: End-to-end flow

**Files:**
- Create: `test/email-verification.e2e-spec.ts`

**Interfaces:**
- Consumes: full app; overrides `ThrottlerGuard` (like `test/auth.e2e-spec.ts`) and `MailQueue` (captures the enqueued URL so the test can extract the raw token without a real queue/email).

- [ ] **Step 1: Write the e2e spec `test/email-verification.e2e-spec.ts`**

```typescript
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { MailQueue } from '../src/mail/mail.queue';
import { ConfigService } from '@nestjs/config';

describe('Email verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  const captured: { url?: string } = {};

  beforeAll(async () => {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(MailQueue)
      .useValue({
        enqueueVerificationEmail: (job: { url: string }) => {
          captured.url = job.url;
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
    await prisma.refreshToken.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushdb();
  });

  afterAll(async () => {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'false';
    await app.close();
  });

  function tokenFromCaptured(): string {
    const url = new URL(captured.url as string);
    return url.searchParams.get('token') as string;
  }

  it('register (toggle on) enqueues a verification link', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: 'Budi', email: 'budi@example.com', password: 'password123' })
      .expect(201);
    expect(captured.url).toMatch(/\/verify-email\?token=/);
  });

  it('login before verifying is rejected with 403', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' })
      .expect(403);
  });

  it('an invalid token is rejected uniformly', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'Invalid or expired verification token.',
    );
  });

  it('verify-email consumes the token and enables login', async () => {
    const token = tokenFromCaptured();
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    // Single-use: the same token no longer works
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400);

    // Now login succeeds
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' })
      .expect(200);
  });

  it('resend-verification returns a uniform 200 for unknown and known emails', async () => {
    const unknown = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect((unknown.body as { success: boolean }).success).toBe(true);

    await redis.flushdb(); // clear cooldown to allow a second request
    const known = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'budi@example.com' })
      .expect(200);
    expect((known.body as { message: string }).message).toBe(
      'If the email is registered, a verification link has been sent.',
    );
  });
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `docker start docker-postgres-1 docker-redis-1 && npm run test:e2e -- email-verification 2>&1 | grep -E "Tests:|✕"`
Expected: all tests pass.

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npx jest --no-coverage 2>&1 | grep "Tests:" && npm run test:e2e 2>&1 | grep "Tests:"`
Expected: all unit + all e2e pass.

- [ ] **Step 4: Commit**

```bash
git add test/email-verification.e2e-spec.ts
git commit -m "test: add end-to-end email verification flow"
```

---

### Task 9: Redaction, docs, and final review

**Files:**
- Modify: `src/app.module.ts` (pino redaction — add token/url guards if any structured log carries them; verify none do)
- Modify: `.superpowers/sdd/progress.md` (ledger)

- [ ] **Step 1: Confirm no raw token/URL is logged outside the dev log driver**

Run: `grep -RnE "auditLog|logger\.(log|warn|error)" src/modules/auth/verification.service.ts src/mail`
Expected: audit logs carry only `event`/`userId` — never `url`/`token`. The only place a URL is printed is `LogMailDriver` (dev-only, blocked in production by the Task 2 refine). Fix any violation found.

- [ ] **Step 2: Full verification**

Run: `npm run lint 2>&1 | tail -2 && npx tsc --noEmit && npx jest --no-coverage 2>&1 | grep "Tests:" && npm run test:e2e 2>&1 | grep "Tests:"`
Expected: lint clean, tsc clean, all unit + e2e pass.

- [ ] **Step 3: Update the progress ledger**

Append a Plan 3 summary to `.superpowers/sdd/progress.md` (commits, security fundamentals covered: TOCTOU single-use, silent-cooldown anti-enumeration, cross-type scoping, prod log-driver guard, async BullMQ, HTML-escaped template).

- [ ] **Step 4: Commit**

```bash
git add .superpowers/sdd/progress.md src/app.module.ts
git commit -m "chore: finalize email verification (redaction check + ledger)"
```

---

## Security Fundamentals Checklist (must all hold at completion)

- [ ] Tokens are 256-bit CSPRNG, stored only as SHA-256, looked up by hash (Task 3, 6).
- [ ] Single-use is atomic: conditional `deleteMany` + `count===1` inside `$transaction` (Task 6) — double-submit races cannot double-verify.
- [ ] Single-active token: issuing deletes prior same-type tokens atomically (Task 6).
- [ ] Token lookup is scoped by `type` — no cross-type reuse; `userId` derived from the token, never the request (Task 6).
- [ ] verify-email failures are uniform (`Invalid or expired verification token.`), no not-found/expired/used distinction (Task 6, 8).
- [ ] resend-verification is enumeration-safe: cooldown set for every request, uniform 200 response, silent skip within cooldown; per-IP throttle handles gross abuse (Task 6, 7, 8).
- [ ] `MAIL_DRIVER=log` is rejected in production; `resend` requires `RESEND_API_KEY` (Task 2).
- [ ] Email async via BullMQ; enqueue failure never fails registration (Task 5, 7).
- [ ] Email template HTML-escapes the user name; link base comes only from `FRONTEND_URL` config (Task 4).
- [ ] Verify does not auto-login; `isEmailVerified` is one-way, only via a valid token (Task 6, 8).
- [ ] Raw tokens/URLs never logged outside the dev-only log driver (Task 9).
