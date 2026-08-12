# Project Conventions & Coding Standards

This document consolidates coding standards, architectural patterns, and enforcement policies across `loopwork-backend`.

## 1. Summary of Enforcement Mechanisms

| Convention / Policy | Primary Mechanism | Enforcement Level | Location Anchor |
| :--- | :--- | :--- | :--- |
| User-facing Language (English) | Code Review & Spec Checklist | Manual Discipline | `CLAUDE.md:36` |
| `import type` Interfaces | `isolatedModules` + ESLint | Enforced by Compiler / Linter | `tsconfig.json:8` |
| DTO Email Normalization | `@NormalizeEmail()` Decorator | Enforced by DTO Pipelines | `src/common/transforms/normalize-email.transform.ts:10` |
| Prisma Unit Test Mocking | `jest.mock()` + `mockDeep<PrismaService>()` | Enforced by Test Runner | `src/prisma/__mocks__/prisma.service.ts:1` |
| Commit Restrictions (`.env`, `Co-Authored-By`) | Git Hook / CI Rules | Enforced by CI / Git | `CLAUDE.md:37` |
| Application Runtime (`tsx` prohibition) | `package.json` scripts | Enforced by Build System | `package.json:6` |
| Cookie Cookie/Refresh Decorators | Custom Decorators/Interceptors | Architectural Pattern | `src/modules/auth/decorators/refresh-token.decorator.ts:5` |
| Password Field Omission | Prisma Client `$extends` Omit | Enforced by Database Layer | `src/prisma/prisma.service.ts:12` |
| Strict TypeScript Checks | `tsconfig.json` (`strict: true`) | Enforced by Compiler | `tsconfig.json:6` |

---

## 2. Detailed Conventions & Code Examples

### Convention 1: User-facing Strings Must Be English

All validation error messages, API responses, Swagger descriptions, and email template strings MUST be written in English.

```typescript
// Location: src/common/validation/validation-message.ts:5
export const ValidationMessage = {
  required: (field: string) => `${field} is required.`,
  invalidEmail: () => `Email format is invalid.`,
  minPassword: (min: number) => `Password must be at least ${min} characters long.`,
};
```

---

### Convention 2: Mandatory `import type` for Interfaces

Use `import type` when importing TypeScript interfaces or type aliases. This prevents decorator metadata emission issues under NestJS compiler settings (`isolatedModules` + `emitDecoratorMetadata`).

```typescript
// Location: src/modules/auth/auth.service.ts:5
import type { User } from '../users/dto/user-response.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { Injectable } from '@nestjs/common';
```

---

### Convention 3: DTO Email Fields Require `@NormalizeEmail()`

Every DTO field receiving an email address MUST include the `@NormalizeEmail()` transform decorator to ensure consistency (lowercase + whitespace trimmed).

```typescript
// Location: src/modules/auth/dto/login.dto.ts:8
import { IsEmail, IsNotEmpty } from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';

export class LoginDto {
  @NormalizeEmail()
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}
```

---

### Convention 4: Unit Test Prisma Mocking via `mockDeep<PrismaService>()`

Spec files requiring `PrismaService` MUST include `jest.mock('../../prisma/prisma.service')` as their first import line, and initialize the mock using `mockDeep<PrismaService>()` from `jest-mock-extended`.

```typescript
// Location: src/modules/users/users.service.spec.ts:1-15
jest.mock('../../prisma/prisma.service');

import { NotFoundException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: UsersService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new UsersService(prisma);
  });
});
```

---

### Convention 5: Commit & Git Restrictions

To avoid sensitive leaks and maintain clean history:
1. **Never commit `.env` or local configuration files.** (`.gitignore:1`)
2. **Never commit generated Prisma clients** located in `src/generated/`. (`.gitignore:14`)
3. **Do not append `Co-Authored-By: Claude`** to commit messages. (`CLAUDE.md:37`)

```bash
# Valid conventional commit
git commit -m "feat(auth): implement google oauth login flow"
```

---

### Convention 6: Application Runtime Execution (`tsx` Prohibition)

Application development and production MUST run via `nest start` or Node compilation (`tsc`). **Do not use `tsx` to run the main application** because `tsx` skips TypeScript's `emitDecoratorMetadata`, which breaks NestJS Dependency Injection (`CLAUDE.md:40`).

```json
// Location: package.json:6-10
"scripts": {
  "start:dev": "nest start --watch",
  "start:prod": "node dist/main",
  "db:seed": "tsx prisma/seed.ts"
}
```
*Note:* `tsx` is permitted exclusively for CLI scripts such as `prisma/seed.ts`.

---

### Convention 7: Refresh Token Handling via Custom Decorators & Interceptors

Do not access or write `res.cookie()` or `req.cookies` directly inside controllers. Use `@RefreshToken()`, `@SetRefreshCookie()`, and `@ClearRefreshCookie()`.

```typescript
// Location: src/modules/auth/auth.controller.ts:190-217
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @SetRefreshCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh access token' })
  @ResponseMessage('Token refreshed successfully.')
  async refresh(@RefreshToken() token: string) {
    return this.auth.refresh(token);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ClearRefreshCookie()
  @ApiOperation({ summary: 'Log out and revoke the refresh token' })
  async logout(@RefreshToken() token: string) {
    return this.auth.logout(token);
  }
```

---

### Convention 8: Password Field Omission & Access Pattern

`PrismaService` globally omits the `password` field from User queries (`src/prisma/prisma.service.ts:12`). When password verification is required, call `findByEmailWithPassword()` or `findByIdWithPassword()` instead of attempting manual query overrides.

```typescript
// Location: src/modules/users/users.service.ts:23
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, password: true, role: true },
    });
  }
}
```

---

### Convention 9: Strict TypeScript Verification

`tsconfig.json` enforces `strict: true`. No implicit `any`, unused variables, or suppressed type checks are permitted.

```json
// Location: tsconfig.json:6
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  }
}
```
