# Testing Guide

The Instagram Reels Automation repository contains a comprehensive, 200+ suite of tests enforcing maximum confidence in the underlying architecture.

## Tooling
- **Framework:** Jest
- **Mocks:** In-memory Database mocking via Jest manual mocks.
- **Assertions:** Jest `expect` interface.

## Test Suites

The repository is divided into three distinct test categories:

### 1. Unit Tests (`tests/services/`, `tests/utils/`)
Focuses on pure logic verification. Validates algorithms like health scoring modifiers, retry exponential backoff calculations, and internal utility functions.

**Run Unit Tests Only:**
```bash
pnpm test:unit
```
*(If script is configured, otherwise standard `pnpm test` will run all).*

### 2. Integration Tests (`tests/integration/`)
Focuses on boundary communication. Verifies that services interact correctly with the Prisma Database schema and external dependencies. Uses mocked Database interactions to simulate read/write operations without hitting a real PostgreSQL database.

**Key Integration Files:**
- `queue.integration.test.ts`: Proves exactly-once dequeueing semantics.
- `health.integration.test.ts`: Proves correct fallback and initialization logic.

### 3. End-to-End Simulation Tests (`tests/e2e/`)
Validates the entire pipeline (Google Drive -> Queue -> Worker -> Meta API -> Telegram -> Database).
The `pipeline.e2e.test.ts` executes **17 exhaustive failure scenarios**, proving the system's ability to gracefully recover from network timeouts, 500 API responses, action blocks, and token expiries.

## Running Tests

**Run all tests:**
```bash
pnpm test
```

**Run tests with Coverage:**
```bash
pnpm test -- --coverage
```

## Continuous Integration
Tests are automatically run via GitHub Actions on every Pull Request and merge to `main`. A PR cannot be merged unless all 200+ tests pass with 0 warnings.
