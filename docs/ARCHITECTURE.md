# Instagram Reels Automation Architecture

This document describes the architectural layout, components, and data flow of the Instagram Reels Automation platform.

## System Overview

The system is a fully autonomous, fault-tolerant background worker designed to pull media from Google Drive and publish it to Instagram via the Meta Graph API. It guarantees exactly-once processing, handles rate-limits through dynamic health scoring, and provides observability via Telegram notifications.

## Components

### 1. Scheduler (`src/services/scheduler.service.ts`)
- **Role:** Periodically polls Google Drive for new MP4 files.
- **Mechanism:** Uses `node-cron` to execute on a configurable interval.
- **Responsibility:** Identifies valid videos, checks if they have been processed previously (via database cache), and enqueues them for processing.

### 2. Upload Queue (`src/queue/upload.queue.ts`)
- **Role:** Ensures sequential, reliable, exactly-once processing of jobs.
- **Mechanism:** Database-backed queue utilizing PostgreSQL (via Prisma). Uses a state-machine (`PENDING` -> `DOWNLOADING` -> `UPLOADING` -> `PROCESSING` -> `PUBLISHING` -> `COMPLETED`/`FAILED`).
- **Responsibility:** Locks jobs to prevent concurrent processing of the same file and maintains order.

### 3. Upload Worker (`src/workers/upload.worker.ts`)
- **Role:** The core processing engine.
- **Mechanism:** Continuously polls the queue for `PENDING` jobs.
- **Responsibility:**
  1. Downloads the video from Google Drive to a temporary local file.
  2. Publishes the video via the Instagram Graph API (container creation & publishing).
  3. Moves the file in Google Drive to an "Uploaded" folder.
  4. Records statistics and notifies Telegram of success or failure.

### 4. Health & Cooldown Service (`src/services/health.service.ts`)
- **Role:** Protects the Instagram account from bans.
- **Mechanism:** Maintains a health score (0-100) per account. Deducts points for API errors (e.g. rate limits, action blocks, token expiry) and restores points upon successful uploads.
- **Responsibility:** Triggers forced cooldowns when the score drops below critical thresholds, pausing all uploads until the account recovers.

### 5. Retry Queue (`src/queue/retry.queue.ts`)
- **Role:** Handles transient failures.
- **Mechanism:** Background loop that checks for failed jobs that haven't exceeded max retry attempts.
- **Responsibility:** Re-queues jobs with exponential backoff.

## Data Flow

1. **Discovery:** Scheduler polls Google Drive.
2. **Enqueue:** New files are inserted into PostgreSQL `UploadJob` table as `PENDING`.
3. **Dequeue:** Worker locks the job and begins download.
4. **Publish:** Worker creates an Instagram media container and waits for readiness.
5. **Finalize:** Worker publishes the container, moves the Google Drive file, and updates PostgreSQL.
6. **Alert:** Telegram receives a formatted notification of the workflow result.

## Database Schema

- **`ProcessedFile`**: Stores historical records of all uploaded files to prevent duplicates.
- **`UploadJob`**: Tracks the state machine of the active queue and retry metadata.
- **`AccountHealth`**: Tracks the health score and active cooldown periods for Instagram accounts.
- **`UploadLog`**: Audit trail for historical uploads and statistics.
