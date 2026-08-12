# Recipe: Adding a New OAuth Provider

This document details how to add a secondary OAuth provider (e.g., GitHub, Apple, Microsoft) to `nest-foundry`.

## Status

**[RENCANA] / PRASYARAT BELUM TERPENUHI:** The baseline architecture currently features a Google-only OAuth implementation hardcoded into `AuthModule` (`src/modules/auth/google-oauth.service.ts:1`). Adding a second provider requires extracting a generic OAuth seam first (`OAuthProviderStrategy` interface).

---

## Prasyarat

1. Extraction of `OAuthProviderStrategy` interface to decouple provider implementations.
2. Provider client credentials configured in `src/config/env.validation.ts:1`.
3. Database schema updated if new provider IDs must be linked to User records (`prisma/schema.prisma:15`).

---

## Langkah

### Step 1: Define Environment Credentials
Add provider secrets to `src/config/env.validation.ts`:
```typescript
GITHUB_CLIENT_ID: z.string().min(1),
GITHUB_CLIENT_SECRET: z.string().min(1),
GITHUB_FRONTEND_CALLBACK_URL: z.string().url(),
```

### Step 2: Implement Provider Strategy (Post-A-02 Architecture)
Create strategy implementing generic `OAuthProviderStrategy` interface:
```typescript
@Injectable()
export class GithubOAuthService implements OAuthProviderStrategy {
  // Map Github profile to standard auth payload
}
```

### Step 3: Add Callback & Exchange Controller Routes
Register route handlers in `src/modules/auth/auth.controller.ts:73` matching existing Google callback mechanics.

---

## Verifikasi

Run verification suite:
```bash
npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e
```
