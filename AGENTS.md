# Entry Point for Coding Agents

This document serves as a thin entry point for non-Claude Code agents (Codex, Cursor, Gemini CLI, etc.).
The primary source of truth remains `CLAUDE.md`, `docs/conventions.md`, and `docs/architecture.md`.

## 1. Orientation

- **Project Name:** `loopwork-backend`
- **Description:** NestJS 11 + TypeScript REST API starter with Prisma, Redis, BullMQ, Argon2, and JWT authentication (`src/app.module.ts:1`).
- **Design Spec:** `docs/superpowers/specs/2026-07-09-nestjs-starter-design.md:1`
- **Status:** Pre-release (Wave 4 complete, operational documentation suite complete).

## 2. Required Execution Pipeline

Before marking any task as complete or submitting code changes, agents MUST execute:

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e
```

| Check | Tool / Command | Requirements & Context | Location Anchor |
| :--- | :--- | :--- | :--- |
| **Linter** | `npm run lint` | ESLint auto-fix check | `package.json:18` |
| **Type Check** | `npx tsc --noEmit` | Strict mode TypeScript compilation | `tsconfig.json:6` |
| **Unit Tests** | `npm run test` | Jest unit test suite | `package.json:19` |
| **E2E Tests** | `npm run test:e2e` | Requires running PostgreSQL + Redis containers. Must run single-threaded (`--runInBand`). | `docs/getting-started.md:1` / `.github/workflows/ci.yml:45` |

## 3. Strict Rules & Prohibitions

Agents MUST comply with these rules BEFORE modifying any code:

| Constraint | Rule & Rationale | Location Anchor |
| :--- | :--- | :--- |
| **No Sensitive/Generated Commits** | Never commit `.env`, generated Prisma client (`src/generated/`), or append `Co-Authored-By: Claude`. | `CLAUDE.md:37` / `.gitignore:1` |
| **No `tsx` for App Runtime** | Development and production must run via `nest start` or `node dist/main`. Using `tsx` skips `emitDecoratorMetadata`, breaking Dependency Injection. `tsx` is permitted exclusively for CLI scripts (`prisma/seed.ts`). | `CLAUDE.md:40` / `package.json:28` |
| **Strict TypeScript Pinning** | `strict: true` enabled in `tsconfig.json`. No implicit `any` or suppressed type errors without explicit technical justification. | `tsconfig.json:6` |
| **Password Field Omission** | The `password` field is omitted by default from Prisma query results (`PrismaService`). Do not write manual queries that bypass this omit; use `users.findByEmailWithPassword()` or `users.findByIdWithPassword()`. | `src/prisma/prisma.service.ts:20` |

## 4. Documentation References (Links Only)

| Topic / Scope | Document Path | Purpose |
| :--- | :--- | :--- |
| **System Architecture** | `docs/architecture.md:1` | Request lifecycle, module boundaries, Redis state, and BullMQ resilience. |
| **Code Conventions** | `docs/conventions.md:1` | Coding standards, response envelope format, DTO validation, and testing mocks. |
| **Audit & Refactor History** | `docs/audit/01-refactor-plan.md:1` | Decision history and context behind current patterns. |
| **Getting Started & Testing** | `docs/getting-started.md:1` | Setup guide, environment variables, Docker Compose, and running tests. |
| **Development Recipes** | `docs/recipes/` | Step-by-step recipes (`add-new-module.md`, `add-oauth-provider.md` [RENCANA], `add-team-feature.md` [RENCANA]). |
| **Progress Plan** | `CLAUDE.md:97` | Active progress plan — MUST be read to determine completed vs planned features. |

## 5. Synchronization Requirement

If an agent completes work that modifies the Progress Plan or core project rules:
- The agent **MUST update `CLAUDE.md` in the exact same commit** as the feature or fix.
- Do not postpone `CLAUDE.md` updates to a separate commit.
