# API Reference

Base URL: `http://localhost:3000`

---

## Authentication

Protected endpoints require the `X-API-Key` header:

```http
X-API-Key: your_api_key_here
```

---

## Public Endpoints

### `GET /health`

Returns system health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-25T16:00:00.000Z",
  "uptime": 3600,
  "responseTimeMs": 5,
  "version": "1.0.0",
  "checks": {
    "database": { "status": "ok" },
    "queue": { "status": "ok", "details": "pending: 0, processing: 1" },
    "scheduler": { "status": "ok", "details": "active" },
    "instagram_processing": { "status": "ok", "details": "1 job(s) in processing" }
  }
}
```

---

### `GET /health/queue`

Returns queue statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "pending": 2,
    "processing": 1,
    "completed": 15,
    "failed": 0,
    "total": 18,
    "activeWorkers": 1
  }
}
```

---

## Upload Endpoints

All require `X-API-Key` header.

### `POST /api/upload/trigger`

Manually triggers a Google Drive poll and enqueues new videos.

**Response:**
```json
{
  "success": true,
  "message": "Upload cycle triggered successfully",
  "data": {
    "queueStats": {
      "pending": 2,
      "processing": 0,
      "completed": 5,
      "failed": 0,
      "total": 7
    }
  }
}
```

---

### `POST /api/upload/enqueue`

Enqueues a specific Google Drive file by ID.

**Request Body:**
```json
{
  "driveFileId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
}
```

**Response:**
```json
{
  "success": true,
  "message": "File enqueued for upload",
  "data": {
    "jobId": "uuid-here",
    "driveFileId": "1BxiMVs0XRA5...",
    "fileName": "video1.mp4"
  }
}
```

---

### `GET /api/upload/jobs`

Lists all upload jobs.

**Query Parameters:**
- `status` (optional): Filter by status (`PENDING`, `DOWNLOADING`, `UPLOADING`, `PROCESSING`, `PUBLISHING`, `COMPLETED`, `FAILED`)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "driveFileId": "...",
      "driveFileName": "video1.mp4",
      "status": "COMPLETED",
      "retryCount": 0,
      "instagramMediaId": "123456",
      "createdAt": "2025-06-25T16:00:00.000Z",
      "updatedAt": "2025-06-25T16:01:30.000Z"
    }
  ]
}
```

---

### `GET /api/upload/jobs/:id`

Returns a specific job by ID.

---

### `GET /api/upload/logs`

Returns upload history.

**Query Parameters:**
- `limit` (optional, default: 100, max: 500)

---

### `GET /api/upload/processed`

Returns list of files that have been successfully uploaded.

---

### `GET /api/upload/stats`

Returns queue statistics.

---

## Webhook Endpoints (n8n)

Used by the n8n workflow to communicate with the backend.

### `POST /api/webhook/n8n/upload`

**Body:** `{ driveFileId, driveFileName }`

### `POST /api/webhook/n8n/status`

**Body:** `{ jobId }`

**Response includes:**
- `containerId` — Instagram container ID
- `instagramStatus` — `IN_PROGRESS | FINISHED | ERROR | EXPIRED`
- `isReady` — boolean

### `POST /api/webhook/n8n/publish`

**Body:** `{ jobId, containerId }`

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Human-readable error description",
  "message": "Technical details (development only)"
}
```

| Status | Description |
|---|---|
| `400` | Validation error — missing or invalid fields |
| `401` | Unauthorized — missing or invalid API key |
| `404` | Not found — endpoint or resource doesn't exist |
| `500` | Internal server error |
