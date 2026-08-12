# Contributing to nest-foundry

Thank you for considering contributing to `nest-foundry`!

## Branching Strategy

`nest-foundry` uses a two-branch workflow:

- **`develop`**: The primary development branch. All active development, features, and bug fixes target `develop` via Pull Requests.
- **`main`**: The production release branch. Only receives merged releases from `develop`. Direct pushes to `main` are prohibited.

### Workflow Example

1. **Create a topic branch from `develop`:**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/my-new-feature
   ```

2. **Run local verification before submitting:**
   ```bash
   npm run lint && npx tsc --noEmit && npm run test
   ```

3. **Open a Pull Request to `develop`:**
   Submit your PR with `develop` selected as the base branch.

4. **Releasing to Production:**
   When code in `develop` is ready for release, a PR is opened from `develop` to `main`.

## Code & Commit Conventions

- Follow Conventional Commits format (e.g., `feat: ...`, `fix: ...`, `chore: ...`).
- Keep commit subjects under 72 characters.
- Ensure all user-facing strings and error messages are in **English**.
- Never commit secrets or generated Prisma files (`src/generated/`).
