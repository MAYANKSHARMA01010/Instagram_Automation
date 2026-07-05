# Monitoring & Observability

The platform is designed to run autonomously. To ensure reliability without requiring constant manual checks, it employs structured logging and proactive Telegram notifications.

## Structured Logging
All background workers, API endpoints, and internal services output JSON-formatted structured logs using Winston.

### Log Format
```json
{
  "level": "info",
  "message": "Starting upload pipeline",
  "service": "instagram-reels-uploader",
  "jobId": "unique-uuid",
  "fileName": "example.mp4",
  "timestamp": "2026-07-04T12:00:00.000Z"
}
```

### Log Aggregation
Because logs are output to `stdout` in JSON format, they are fully compatible with external aggregators like Datadog, Logtail, or AWS CloudWatch. If you deploy on Render, you can forward logs natively to Datadog.

## Telegram Notifications
The system uses Telegram as a lightweight observability dashboard. You will receive immediate alerts for:
- **Successful Uploads:** Includes timing metrics and Instagram Media IDs.
- **Failures:** Includes the exact failure reason (e.g., Timeout, Unsupported Format, Meta API error).
- **Health Restrictions:** If Meta imposes an action block, you will receive a high-priority alert indicating the account's health score and forced cooldown duration.

## Health Endpoints
An external monitoring service (e.g., UptimeRobot, BetterUptime) should hit the public `/health` endpoint to verify system liveness.
- **Endpoint:** `GET /health`
- **Response:** `200 OK`
- **Payload:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "queue": {
    "pending": 0,
    "processing": 1,
    "failed": 2
  }
}
```
