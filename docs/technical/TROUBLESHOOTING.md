# Troubleshooting Guide

---

## Application Won't Start

### Missing environment variables

**Error:** `Missing required environment variables: GOOGLE_CLIENT_ID, ...`

**Fix:** Copy `.env.example` to `.env` and fill in all required values:
```bash
cp .env.example .env
nano .env
```

---

### Port already in use

**Error:** `Port 3000 is already in use`

**Fix:** Either stop the other process or change the port:
```bash
# Find what's using port 3000
lsof -i :3000

# Or change port in .env
PORT=3001
```

---

### TypeScript compilation errors

**Error:** `Cannot find module ... or its corresponding type declarations`

**Fix:**
```bash
npm install
npm run build
```

---

## Google Drive Issues

### "invalid_grant" error

**Cause:** Refresh token is expired or revoked.

**Fix:**
1. Go to https://myaccount.google.com/permissions
2. Remove the app authorization
3. Run: `node scripts/get-refresh-token.js`
4. Update `GOOGLE_REFRESH_TOKEN` in `.env`

---

### "The user does not have sufficient permissions"

**Cause:** Your Google account doesn't have access to the Drive folder.

**Fix:** Make sure you're authenticating with the Google account that owns the folder.

---

### Files not being detected

**Checklist:**
1. Verify `GOOGLE_DRIVE_FOLDER_ID` matches the folder URL exactly
2. Files must be `.mp4` format
3. Files must not be in the trash
4. Check `GET /api/upload/trigger` response for errors

---

## Instagram Upload Issues

### "Invalid OAuth access token"

**Cause:** Your Meta access token has expired (long-lived tokens last 60 days).

**Fix:** Generate a new long-lived token. See [SETUP_INSTAGRAM.md](./SETUP_INSTAGRAM.md).

---

### Container status = ERROR with code 2207026

**Cause:** Video format not supported.

**Requirements for Instagram Reels:**
- Format: MP4
- Codec: H.264
- Audio: AAC
- Aspect ratio: 9:16 (recommended)
- Resolution: 1080×1920 (recommended)
- Duration: 3–90 seconds

---

### Container status = ERROR with code 2207001

**Cause:** Video is too short (must be at least 3 seconds) or too long (max 90 seconds for Reels, 15 min for videos).

---

### "Publishing limit reached"

**Cause:** You've hit Instagram's 25 Reels per 24 hours limit.

**Fix:** Wait 24 hours. The scheduler will automatically retry.

---

### Container stuck in IN_PROGRESS

**Cause:** Instagram is taking longer than usual to process the video.

**Fix:** The app waits up to 30 minutes (`STATUS_POLL_TIMEOUT_MS`). If it still fails, the job will be retried automatically.

---

## Docker Issues

### Container won't start

```bash
# Check logs
docker-compose logs app

# Check if .env exists
ls -la .env

# Rebuild
docker-compose down
docker-compose up -d --build
```

---

### n8n shows "Connection refused" to backend

**Cause:** The `app` service may still be starting.

**Fix:** Wait 30 seconds for the backend to be ready, then retry. The URL `http://app:3000` is the internal Docker network address.

---

### Database file not persisting after restart

**Cause:** Volume not configured correctly.

**Fix:** Verify volumes are mounted:
```bash
docker volume ls | grep reels
```

---

## Logging

View real-time logs:
```bash
# Docker
docker-compose logs -f app

# Direct
tail -f logs/app.log
tail -f logs/error.log
```

---

## Checking Upload Status

```bash
# Health check
curl http://localhost:3000/health | jq .

# Queue stats
curl http://localhost:3000/health/queue | jq .

# Upload logs (requires API key)
curl -H "X-API-Key: your_key" http://localhost:3000/api/upload/logs | jq .

# All jobs
curl -H "X-API-Key: your_key" http://localhost:3000/api/upload/jobs | jq .
```

---

## Resetting a Failed Upload

If a file is stuck in a bad state:

```bash
# Connect to SQLite
sqlite3 database/uploads.db

# View all jobs
SELECT id, drive_file_id, drive_file_name, status FROM upload_jobs;

# Reset a specific job to PENDING
UPDATE upload_jobs SET status = 'PENDING', retry_count = 0 WHERE drive_file_id = 'your_file_id';

# Remove from processed files to allow re-upload
DELETE FROM processed_files WHERE drive_file_id = 'your_file_id';

.quit
```

---

## Getting Help

1. Check `logs/error.log` for detailed error messages
2. Enable debug logging: `LOG_LEVEL=debug` in `.env`
3. Verify your access tokens haven't expired
4. Check Meta API status: https://developers.facebook.com/status/
