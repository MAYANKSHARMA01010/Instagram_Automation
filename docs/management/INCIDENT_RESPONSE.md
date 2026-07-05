# Incident Response Guide

## Recovery Time Objectives (RTO)

Target recovery times for known failure scenarios:

| Incident | Target Recovery | Description |
| :--- | :--- | :--- |
| **Render restart** | < 5 min | Automated via startup sequence (`recoverStuckJobs`). |
| **Google outage** | Automatic | `googleapis` backoff + Poller cron retries implicitly. |
| **Meta timeout** | Retry queue | Automated via `UploadQueue` backoff logic. |
| **DB reconnect** | < 2 min | Automated via Prisma reconnect logic. |
| **Token expiry** | Manual | Operator must generate a new token via Meta portal. |

## Playbooks

### Incident A: Meta API Outage / Action Block Avalanche
- **Symptoms:** Multiple jobs instantly failing with `action_blocked` or `checkpoint_required`.
- **Likely Cause:** Meta's spam filters have flagged the account or IP address.
- **Verification Steps:** Check the database `error_message` column for Graph API responses.
- **Recovery Procedure:** 
  1. The system automatically places the account into a 48-hour cooldown. Do not bypass this.
  2. The system automatically clamps capacity to 25% post-cooldown.
  3. Verify the account manually in the Instagram app to solve any Captchas.

### Incident B: Render Container Restart / Crash
- **Symptoms:** Uptime resets to 0. Telegram sends an unexpected "Server Started" message.
- **Likely Cause:** OOM Kill, underlying hardware rotation, or manual deploy.
- **Verification Steps:** Check Render events tab for "Exited with status 137" (OOM).
- **Recovery Procedure:** Zero manual intervention required. `recoverStuckJobs` on boot automatically salvages in-flight and retry queue jobs.

### Incident C: Duplicate Upload Detected
- **Symptoms:** The same video appears twice on the Instagram feed.
- **Likely Cause:** Database unique constraint failure or Instagram Graph API `timeout` returning a false failure but succeeding on Meta's backend.
- **Verification Steps:** Check the database for duplicate `driveFileId`.
- **Recovery Procedure:** Since DB `P2002` locks are in place, the cause is almost certainly a Graph API false-failure. Manually delete the duplicate on Instagram.

### Incident D: Token Expiration
- **Symptoms:** Every upload fails instantly with `auth error` or `session_expired`.
- **Likely Cause:** 60-day Graph API Token expired.
- **Verification Steps:** Check Telegram for the 10-day warning notification.
- **Recovery Procedure:** Generate a new long-lived token via the Meta Developer Portal and update `META_API_TOKEN` in Render.
