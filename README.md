# Instagram Reels Auto Uploader

> **Production-ready** automated system that uploads Instagram Reels directly from a Google Drive folder using the Meta Graph API, Node.js, TypeScript, and n8n.

---

## 🚀 Features

- ✅ **Fully automated** — drop a video in Google Drive, it uploads itself
- ✅ **Duplicate prevention** — never re-uploads the same file
- ✅ **Retry with backoff** — automatically retries on failures
- ✅ **Large video support** — streamed download & upload (no memory limits)
- ✅ **n8n workflow** — complete importable automation workflow
- ✅ **Telegram notifications** — success & failure alerts
- ✅ **Winston logging** — rotating log files with levels
- ✅ **SQLite database** — upload history & processed file tracking
- ✅ **Docker ready** — fully containerized with health checks
- ✅ **Health endpoint** — monitor service status
- ✅ **Graceful shutdown** — safe process termination
- ✅ **Config validation** — fails fast if env vars are missing
- ✅ **Strict TypeScript** — fully typed, no `any`

---

## 📁 Google Drive Structure

```
My Drive/
└── Instagram/
    ├── Videos/          ← Drop your .mp4 files here
    │   ├── video1.mp4
    │   └── video2.mp4
    └── Uploaded/        ← Files move here after upload
```

---

## ⚡ Quick Start

### Option 1: Docker (Recommended)

```bash
# 1. Clone / navigate to project
cd instagram-reels-uploader

# 2. Run the setup script
bash scripts/setup.sh

# 3. Fill in your credentials
nano .env

# 4. Get your Google refresh token
node scripts/get-refresh-token.js

# 5. Add your cover image
cp /path/to/your/cover.jpg public/cover/cover.jpg

# 6. Edit your caption
nano caption.txt

# 7. Start everything
docker-compose up -d

# 8. Import n8n workflow
# Open http://localhost:5678 → Settings → Import From File → n8n/workflow.json
```

### Option 2: Without Docker

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Fill in credentials
cp .env.example .env
nano .env

# 4. Start server
npm start

# Development mode (with hot reload)
npm run dev
```

---

## 🔧 Configuration

All configuration is done via `.env`. See [.env.example](./.env.example) for all options.

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth2 Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth2 Client Secret |
| `GOOGLE_REFRESH_TOKEN` | ✅ | OAuth2 Refresh Token (from setup script) |
| `GOOGLE_DRIVE_FOLDER_ID` | ✅ | "Videos" folder ID in Drive |
| `GOOGLE_DRIVE_UPLOADED_FOLDER_ID` | ✅ | "Uploaded" folder ID in Drive |
| `INSTAGRAM_ACCOUNT_ID` | ✅ | Instagram Business Account ID |
| `GRAPH_API_TOKEN` | ✅ | Meta long-lived access token |
| `API_KEY` | ✅ | Secret key for your API endpoints |
| `CAPTION_FILE` | ❌ | Path to caption.txt (default: `./caption.txt`) |
| `COVER_IMAGE` | ❌ | Path to cover.jpg |
| `TELEGRAM_BOT_TOKEN` | ❌ | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | ❌ | Telegram chat/group ID |
| `POLLING_CRON` | ❌ | Cron for Drive polling (default: `*/10 * * * *`) |

---

## 📡 API Endpoints

### Public (no auth required)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Application health check |
| `GET` | `/health/queue` | Queue statistics |

### Protected (requires `X-API-Key` header)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload/trigger` | Trigger a Drive poll cycle |
| `POST` | `/api/upload/enqueue` | Enqueue specific file by Drive ID |
| `GET` | `/api/upload/jobs` | List all upload jobs |
| `GET` | `/api/upload/jobs/:id` | Get specific job |
| `GET` | `/api/upload/logs` | Upload history |
| `GET` | `/api/upload/stats` | Queue statistics |
| `POST` | `/api/webhook/n8n/upload` | n8n upload trigger |
| `POST` | `/api/webhook/n8n/status` | n8n status check |
| `POST` | `/api/webhook/n8n/publish` | n8n publish trigger |

---

## 📋 Upload Workflow

```
Google Drive (Videos/)
  ↓ [Cron poll every 10min]
Detect new .mp4 files
  ↓ [Filter processed files]
Enqueue new files
  ↓
Download from Google Drive (streaming)
  ↓
Validate file (MP4, size, not empty)
  ↓
Upload video to Meta servers
  ↓
Create Instagram Reel container
  ↓
Poll status until FINISHED
  ↓
Publish Reel
  ↓
Move file to Drive Uploaded/
  ↓
Record in database
  ↓
Send Telegram notification
```

---

## 🔔 Telegram Notifications

**Success:**
```
✅ Reel Uploaded Successfully

📹 File: video1.mp4
🆔 Media ID: 123456789
⏱ Duration: 47s
📂 Drive ID: 1abc...xyz
🕐 Time: Wed, 25 Jun 2025 16:00:00 GMT
```

**Failure:**
```
❌ Reel Upload Failed

📹 File: video2.mp4
📂 Drive ID: 1def...uvw
💬 Reason: Network timeout after 3 retries
🔍 Stack: Error: connect ETIMEDOUT...
🕐 Time: Wed, 25 Jun 2025 16:05:00 GMT
```

---

## 📂 Project Structure

```
src/
├── config/          # App config + database
├── controllers/     # HTTP request handlers
├── database/        # SQLite models & repository
├── middlewares/     # Auth, error, validation
├── queue/           # Upload queue + retry queue
├── routes/          # Express routers
├── services/        # Google Drive, Instagram, Telegram
├── types/           # TypeScript interfaces
├── utils/           # Logger, retry, validators
└── workers/         # Upload, download, status workers
```

---

## 🐳 Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop all services
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

**Services:**
- `app` → Backend API on port `3000`
- `n8n` → Automation UI on port `5678`

---

## 📊 Monitoring

```bash
# Health check
curl http://localhost:3000/health

# Queue statistics
curl http://localhost:3000/health/queue

# Upload logs (requires API key)
curl -H "X-API-Key: your_key" http://localhost:3000/api/upload/logs
```

---

## 📖 Documentation

- [Google API Setup](./docs/SETUP_GOOGLE.md)
- [Instagram Graph API Setup](./docs/SETUP_INSTAGRAM.md)
- [API Reference](./docs/API.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

---

## 🛠 Development

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format
```

---

## 📜 License

MIT
