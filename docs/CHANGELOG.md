# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-05

### Added
- **Core Engine:** Fully autonomous background worker syncing MP4s from Google Drive to Instagram Reels.
- **Queue System:** Exactly-once processing guarantee utilizing PostgreSQL state-machine (`UploadJob`).
- **Resiliency:** Dynamic Health Scoring Engine. Safely triggers global cooldowns upon detecting Meta API `action_blocked` or `checkpoint_required` errors.
- **Resiliency:** Exponential backoff retry queue for transient 500/504 errors.
- **Resiliency:** Automatic cache fallback for Google Drive API to prevent quota exhaustion.
- **Observability:** Centralized JSON logging structured for Datadog / CloudWatch.
- **Observability:** Telegram Bot integration for real-time success, failure, and health cooldown alerts.
- **Testing:** 200+ tests including exhaustive End-to-End simulations verifying 17 core failure scenarios.
- **CI/CD:** Native GitHub Actions configuration for automated PR testing, linting, and continuous Docker deployments to Render.
- **Documentation:** Complete operations, architecture, and troubleshooting documentation in `/docs`.

### Changed
- Refactored legacy SQLite database configuration entirely to PostgreSQL via Prisma.
- Replaced in-memory job maps with persistent database row locks.

### Fixed
- Fixed critical bug where process termination during upload resulted in zombie containers on Meta's servers.
- Fixed duplicate uploads occurring during parallel cron executions.

### Removed
- Removed legacy local-filesystem SQLite artifacts (`database/uploads.db`).
- Removed redundant setup scripts in favor of standardized `.env` instructions.
