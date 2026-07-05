# Development Rules

These rules govern all future contributions to the Instagram Reels Automation project. They are non-negotiable and designed to maintain system reliability.

## 1. No direct commits to `main`
All work must happen on feature branches (`feature/*`, `fix/*`). Commits to `main` are restricted to CI/CD automated merges.

## 2. CI Pipeline MUST pass
Every pull request is automatically tested by GitHub Actions. A PR cannot be merged unless:
- `eslint` passes with zero warnings.
- `tsc` (TypeScript compiler) passes with zero type errors.
- All 200+ Jest tests pass.

## 3. Every new feature requires tests
If you add a new service, you must add a corresponding unit test. If you add a new failure scenario, it must be added to the E2E simulation (`tests/e2e/pipeline.e2e.test.ts`). Coverage should never drop below 85%.

## 4. Configuration Synchronization
Every configuration change (adding or removing an environment variable) **must** update:
1. `src/config/index.ts`
2. `.env.example`
3. `docs/CONFIGURATION.md`

## 5. Database Schema Changes
Every change to `schema.prisma` requires:
- Generating a new migration (`npx prisma migrate dev`).
- Updating documentation in `docs/ARCHITECTURE.md` if a new table is introduced.

## 6. API Changes
Any change to the internal API (e.g. the `/health` endpoint) must be documented in `docs/API.md`.

## 7. No secrets in Git
Never commit `.env` or any JSON files containing Google/Meta tokens.

## 8. Changelog
Every production bug fix or new feature must be documented in `CHANGELOG.md` under the "Unreleased" section, to be rolled into the next semantic version tag.
