# Cloudflare R2 Deployment Guide

This guide provides comprehensive instructions for deploying and configuring Cloudflare R2 as the temporary media storage layer for the Instagram Automation pipeline.

## 1. Bucket Creation

1. Log into the [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Navigate to **R2**.
3. Click **Create bucket**.
4. Set the **Bucket name** (e.g., `instagram-automation-tmp`).
5. Choose the appropriate location hint for your deployment region to minimize latency (e.g., `WEUR` if your Render servers are in Frankfurt).
6. Click **Create bucket**.

## 2. IAM Credentials (API Tokens)

To allow the application to upload and delete files, you must generate an S3 API token.

1. Navigate to the **R2** dashboard overview.
2. Click **Manage R2 API Tokens**.
3. Click **Create API token**.
4. Provide a descriptive name (e.g., `Instagram Uploader Worker`).
5. Under **Permissions**, select **Object Read & Write**.
6. (Optional but recommended) Scope the token exclusively to the `instagram-automation-tmp` bucket.
7. Click **Create API Token**.
8. **IMPORTANT:** Copy the `Access Key ID`, `Secret Access Key`, and the `Jurisdiction-specific endpoint` (the URL ending in `.r2.cloudflarestorage.com`). These will not be shown again.

## 3. Object Lifecycle Rule

To guarantee that orphaned objects do not accumulate and cost money, configure an automatic expiration lifecycle rule. The application cleans up objects on success and failure, but a Node OOM or SIGKILL could orphan objects.

1. Go to your R2 bucket settings.
2. Navigate to **Object Lifecycle rules**.
3. Click **Add rule**.
4. Set **Rule name** (e.g., `Delete orphaned temporary media`).
5. Set the rule condition (Apply to all objects or filter by prefix if sharing the bucket).
6. Set the **Action** to **Expire (delete) object**.
7. Set the **Age** to `3` days.
8. Click **Add rule**.

## 4. CORS Configuration

For Signed URLs to function properly when Instagram fetches the asset directly from R2, CORS must allow GET requests from anywhere (since Meta IP blocks are vast and change frequently).

1. In your R2 bucket settings, navigate to **CORS Policy**.
2. Click **Edit CORS policy**.
3. Paste the following JSON configuration:

```json
[
  {
    "AllowedOrigins": [
      "*"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

## 5. Render Environment Variables

To activate R2 storage on Render, set the following environment variables in your Render Blueprint or Dashboard:

```env
# Switch storage provider to R2
STORAGE_PROVIDER=r2

# R2 Configuration
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=instagram-automation-tmp
```

Once the environment variables are configured, the `getStorageService()` factory will automatically instantiate the `R2StorageService` and validate credentials via a `HeadBucket` health check on startup.
