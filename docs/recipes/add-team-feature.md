# Recipe: Adding Multi-Tenant / Team Features

This recipe outlines the architectural changes required to introduce multi-tenancy or Team/Organization concepts to `nest-foundry`.

## Status

**[RENCANA] / PRASYARAT BELUM TERPENUHI:** `nest-foundry` is intentionally designed as a single-tenant starter template (`docs/architecture.md:189`). The `AuthenticatedUser` and `JwtPayload` models intentionally omit `activeTeamId` by design (YAGNI).

---

## Prasyarat

1. Product requirement approval for multi-tenancy.
2. Tenant isolation model selection (Schema-per-tenant vs `tenant_id` row-level filtering).

---

## Langkah

### Step 1: Update Database Schema
Define `Team` entity and `TeamMember` junction model in `prisma/schema.prisma`:
```prisma
model Team {
  id        String       @id @default(cuid())
  name      String
  members   TeamMember[]
  createdAt DateTime     @default(now())
}

model TeamMember {
  id     String @id @default(cuid())
  teamId String
  userId String
  role   String
}
```

### Step 2: Extend JWT Payload & Authenticated User Decorator
Update `JwtPayload` interface (`src/modules/auth/interfaces/jwt-payload.interface.ts`) and `@CurrentUser()` decorator (`src/common/decorators/current-user.decorator.ts:10`):
```typescript
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  activeTeamId?: string;
}
```

### Step 3: Implement Tenant Guard & Context Middleware
Create `TeamContextGuard` to extract `X-Team-ID` headers and validate user membership against Redis or Prisma.

---

## Verifikasi

Run full test suite:
```bash
npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e
```
