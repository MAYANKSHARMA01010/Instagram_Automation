# R2 Production Rollout & Rollback Guide

This document outlines the phased strategy for rolling out Cloudflare R2 into production, safely validating its performance, and immediately rolling back if issues arise.

## 1. Production Rollout Guide

The rollout will occur in three strictly controlled stages.

### Stage 1: The DRY_RUN Phase
In this stage, the system will upload media to R2 and generate Signed URLs, but it will **not** attempt to publish anything to Instagram. The purpose is to validate the storage lifecycle and credentials in production.

1. Deploy the latest version of the repository to Render.
2. Ensure the following environment variables are set:
   ```env
   STORAGE_PROVIDER=r2
   DRY_RUN=true
   # ... (and all R2 authentication vars)
   ```
3. Monitor the application logs for 24 hours.
4. Verify the following:
   - `Starting storage upload` is logged.
   - `Storage upload completed` is logged with reasonable `durationMs`.
   - `Storage object cleaned up` is successfully executing in the `finally` block.
   - No `InfrastructureError` exceptions are thrown from the storage service.
   - Wait 3 days to verify the bucket is actually empty (Cloudflare Lifecycle rule is working for any orphaned tests).

### Stage 2: Single Account Activation
Once `DRY_RUN` is confirmed stable, we will test real uploads on a single low-risk Instagram account.

1. Set `DRY_RUN=false`.
2. Observe the first few reel uploads via the dashboard or logs.
3. Validate that Meta (Instagram) can successfully resolve and download the signed URL.
4. Check the `StatisticsService` daily summary to ensure `uploadFailures` and `signedUrlFailures` remain at `0`.

### Stage 3: Full Rollout
Once Stage 2 is stable for 48 hours without elevated failure rates.

1. Application continues running normally.
2. Decommission the old `/public/tmp` static file server configurations if they are no longer needed (future PR).

---

## 2. Rollback Guide

The application was designed to allow hot-swapping between `local` and `r2` storage. If Cloudflare R2 experiences an outage or Meta blocks the Cloudflare IPs, you can immediately rollback to local storage.

1. Access the Render Dashboard.
2. Edit the environment variables.
3. Change `STORAGE_PROVIDER=r2` back to `STORAGE_PROVIDER=local`.
4. Trigger a Manual Deploy / Restart.

**Validation:**
- The application will gracefully fall back to storing files in `/public/tmp`.
- No code changes are required.
- The `UploadWorker` will seamlessly return to using `PUBLIC_URL` concatenation instead of R2 Signed URLs.

---

## 3. Production Verification Checklist

During Stage 1 and Stage 2, Site Reliability Engineers MUST verify the following before signing off:

- [ ] **Storage Health:** The `/health` endpoint reports `status: "healthy"` and storage is not marked degraded.
- [ ] **Uploads:** Log entries confirm successful `uploadFile` execution without throwing.
- [ ] **Cleanup:** Log entries confirm `deleteFile` is invoked and succeeds (`Storage object cleaned up`).
- [ ] **Statistics:** The in-memory statistics correctly accumulate `uploadDurationTotalMs` and `bytesUploadedTotal`.
- [ ] **Lifecycle:** The Cloudflare R2 Dashboard confirms that the bucket size is 0 bytes when no jobs are actively processing.
- [ ] **Signed URLs:** The generated URLs are correctly structured and return `200 OK` (when accessed before they expire).
- [ ] **Retries:** If an upload fails, the standard retry queue correctly delays and re-attempts the job.
- [ ] **Cooldowns:** If the storage provider repeatedly fails, the health service correctly institutes a cooldown to prevent rapid retry loops.
