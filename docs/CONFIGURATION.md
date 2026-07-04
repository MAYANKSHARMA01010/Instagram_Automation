# Configuration Guide

The Instagram Reels Automation platform is strictly controlled via environment variables.

All configuration variables should be defined in a `.env` file at the root of the project.

## Core Services

### API Keys
- `API_KEY` (Required): A secure token used to protect internal webhooks or manual trigger endpoints.

### Application Routing
- `PORT` (Optional): The port the Express server binds to (default: `3000`).
- `PUBLIC_URL` (Required): The publicly accessible URL of this application (e.g., `https://my-app.onrender.com`). This is strictly required because the Meta Graph API needs a public URL to download the video container from.

### Database
- `DATABASE_URL` (Required): The PostgreSQL connection string for Prisma. Example: `postgresql://user:password@host:5432/db`

## External Integrations

### Google Drive API
You must create a Google Cloud Project with the Drive API enabled.
- `GOOGLE_CLIENT_ID` (Required): Your Google OAuth 2.0 Client ID.
- `GOOGLE_CLIENT_SECRET` (Required): Your Google OAuth 2.0 Client Secret.
- `GOOGLE_REFRESH_TOKEN` (Required): A long-lived refresh token authorized for your Drive account. (Generate using `npm run setup`).

### Meta / Instagram Graph API
You must have a Meta Developer App linked to a Facebook Page and Instagram Professional Account.
- `GRAPH_API_TOKEN` (Required): A long-lived Page Access Token.

### Telegram Notifications (Optional)
Receive real-time alerts about successes, failures, and account restrictions.
- `TELEGRAM_BOT_TOKEN`: The API token from BotFather.
- `TELEGRAM_CHAT_ID`: The Chat ID (user or group) to send messages to.

## Account Mapping (Multi-Account Setup)
The platform supports multi-account processing.
- `ACCOUNTS_CONFIG` (Required): A JSON-stringified array mapping Google Drive folders to Instagram Account IDs.

**Example Format:**
```json
[
  {
    "driveFolderId": "1A2b3C4d5E...",
    "driveUploadedFolderId": "5E4d3C2b1A...",
    "instagramAccountId": "178414XXXXXXX"
  }
]
```
*Note: Legacy single-account variables (`GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_UPLOADED_FOLDER_ID`, `INSTAGRAM_ACCOUNT_ID`) are supported but deprecated.*

## Tunable Parameters

- `CRON_SCHEDULE` (Optional): Cron expression for checking Google Drive (default: `*/10 * * * *` — every 10 minutes).
- `MAX_UPLOADS_PER_DAY` (Optional): Safe limit for uploads to prevent API spam flags (default: `5`).
- `MAX_RETRY_ATTEMPTS` (Optional): Maximum times a failed video upload will retry (default: `3`).
- `MAX_CONCURRENT_UPLOADS` (Optional): Number of videos to process simultaneously across accounts (default: `1`).
