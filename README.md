# 🚀 Instagram Automation

> Production-ready Instagram Reels Automation platform with Google Drive integration, intelligent scheduling, account health management, proxy isolation, and Telegram monitoring.

![GitHub release](https://img.shields.io/github/v/release/MAYANKSHARMA01010/Instagram_Automation?style=for-the-badge)
![GitHub last commit](https://img.shields.io/github/last-commit/MAYANKSHARMA01010/Instagram_Automation?style=for-the-badge)
![License](https://img.shields.io/github/license/MAYANKSHARMA01010/Instagram_Automation?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Google Drive](https://img.shields.io/badge/Google%20Drive-API-4285F4?style=for-the-badge&logo=google-drive)
![Meta Graph API](https://img.shields.io/badge/Meta-Graph%20API-0866FF?style=for-the-badge&logo=meta)
![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?style=for-the-badge&logo=telegram)
![Platform](https://img.shields.io/badge/Platform-Render-46E3B7?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)
![Proxy Support](https://img.shields.io/badge/Proxy-HTTP%20%7C%20HTTPS%20%7C%20SOCKS5-blue?style=for-the-badge)
![Account Health](https://img.shields.io/badge/Account-Health%20Engine-success?style=for-the-badge)
![Scheduler](https://img.shields.io/badge/Smart-Scheduler-orange?style=for-the-badge)
![Production Ready](https://img.shields.io/badge/Production-Ready-success?style=for-the-badge)

------------------------------------------------------------
## 🚀 Instagram Automation Workflow
------------------------------------------------------------

```text
    Google Drive
          ↓
    Download Worker
          ↓
    Upload Queue
          ↓
    Scheduler
          ↓
    Instagram Graph API
          ↓
    Telegram Notifications
```

------------------------------------------------------------

## ✨ Features
- **Exactly-Once Processing**: Database-backed queue prevents duplicate uploads even under heavy parallel load.
- **Dynamic Account Health**: Auto-adjusting health scores trigger adaptive cooldowns to prevent Instagram bans.
- **Proxy Isolation**: Per-account HTTP/HTTPS/SOCKS5 proxy support to reduce network correlation.
- **Transient Failure Recovery**: Built-in exponential backoff retry queue for handling 5xx API errors.
- **Telegram Observability**: Real-time structured alerting for uploads, errors, and platform restrictions.
- **Multi-Account Ready**: Process multiple drive folders mapped to multiple Instagram accounts simultaneously.

## 🏗 Architecture
See the [Architecture Details](docs/technical/ARCHITECTURE.md) for in-depth system design, including the dual-worker architecture (Upload and Status workers), queue processors, health scoring algorithms, and proxy context injection.

## ⚙ Tech Stack
- **Language**: TypeScript (Node.js 18+)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Scheduling**: Node-Cron
- **External Integrations**: Google Drive API, Meta Graph API, Telegram Bot API
- **Proxy Support**: https-proxy-agent, socks-proxy-agent
- **Deployment**: Docker, Render

## 🚀 Quick Start

### 1. Requirements
- Node.js v20+
- PostgreSQL Database
- Google Cloud Project (Drive API)
- Meta Developer App (Graph API)

### 2. Installation
```bash
git clone https://github.com/MAYANKSHARMA01010/Instagram_Automation.git
cd Instagram_Automation
pnpm install
```

### 3. Configuration
Copy the `.env.example` file to `.env` and fill in your credentials.
```bash
cp .env.example .env
```
Refer to the [Configuration Guide](docs/technical/CONFIGURATION.md) for details on all available environment variables.

### 4. Database Setup
```bash
pnpm exec prisma db push
```

### 5. Testing
```bash
pnpm run test
```

### 6. Running
```bash
pnpm run build
pnpm run start
```

## 📂 Project Structure
The `/docs` directory contains the complete source of truth for operating and maintaining this system.

### Architecture & Engineering
- [Architecture Details](docs/technical/ARCHITECTURE.md)
- [API Reference](docs/technical/API.md)
- [Testing Guide](docs/technical/TESTING.md)

### Deployment & Setup
- [Configuration Guide](docs/technical/CONFIGURATION.md)
- [Deployment Guide](docs/technical/DEPLOYMENT.md)

### SRE & Operations
- [Operations Manual](docs/technical/OPERATIONS.md)
- [Monitoring & Logging](docs/technical/MONITORING.md)
- [Troubleshooting](docs/technical/TROUBLESHOOTING.md)
- [Incident Response](docs/management/INCIDENT_RESPONSE.md)

### Contribution
- [Development Rules](docs/management/DEVELOPMENT_RULES.md)

## 🔒 Security
Please refer to the [Architecture Details](docs/technical/ARCHITECTURE.md) and Release documentation for details on defense-in-depth security, credential sanitization in logs, and network context isolation.

## 📈 Roadmap
- [ ] Comprehensive unit tests for `InstagramService`
- [ ] Startup Proxy Validation & Diagnostics
- [ ] External Media Hosting (Cloudflare R2 / AWS S3) for end-to-end network isolation
- [ ] Advanced Account Identity (User-Agent, locale rotation)

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
