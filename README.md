# Instagram Reels Automation

A fully autonomous, self-healing background worker that syncs `.mp4` video files from Google Drive and publishes them to Instagram Reels using the Meta Graph API.

## Features
- **Exactly-Once Processing**: Database-backed queue prevents duplicate uploads even under heavy parallel load.
- **Dynamic Account Health**: Auto-adjusting health scores trigger adaptive cooldowns to prevent Instagram bans.
- **Transient Failure Recovery**: Built-in exponential backoff retry queue for handling 5xx API errors.
- **Telegram Observability**: Real-time structured alerting for uploads, errors, and platform restrictions.
- **Multi-Account Ready**: Process multiple drive folders mapped to multiple Instagram accounts simultaneously.

## Quick Start

### 1. Requirements
- Node.js v20+
- PostgreSQL Database
- Google Cloud Project (Drive API)
- Meta Developer App (Graph API)

### 2. Installation
```bash
git clone <repository_url>
cd Instagram_Automation
pnpm install
```

### 3. Configuration
Copy the `.env.example` file to `.env` and fill in your credentials.
```bash
cp .env.example .env
```
Refer to the [Configuration Guide](docs/CONFIGURATION.md) for details on all available environment variables.

### 4. Database Setup
```bash
pnpm exec prisma db push
```

### 5. Running
```bash
pnpm build
pnpm start
```

## Documentation Index

The `/docs` directory contains the complete source of truth for operating and maintaining this system.

### Architecture & Engineering
- [Architecture Details](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Testing Guide](docs/TESTING.md)

### Deployment & Setup
- [Configuration Guide](docs/CONFIGURATION.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

### SRE & Operations
- [Operations Manual](docs/OPERATIONS.md)
- [Monitoring & Logging](docs/MONITORING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Incident Response](docs/INCIDENT_RESPONSE.md)

## Contribution & Development
Please refer to the [Development Rules](DEVELOPMENT_RULES.md) for contribution guidelines. All PRs must pass the CI pipeline (`pnpm test` and `eslint`).
