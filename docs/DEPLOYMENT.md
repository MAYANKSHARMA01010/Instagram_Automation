# Deployment Guide

The Instagram Reels Automation platform is designed to be easily deployable on modern containerized hosting environments, particularly **Render.com**.

## Prerequisites

1. A PostgreSQL Database (e.g., Neon.tech, Supabase, or AWS RDS).
2. Verified Meta Graph API credentials.
3. Verified Google Drive API credentials.

## Deploying to Render.com

Render is the recommended hosting platform as the provided `render.yaml` (if used) or standard Docker deployment handles the web-service and background processing seamlessly.

### 1. Create a Web Service
1. Connect your GitHub repository to Render.
2. Select **New Web Service**.
3. Environment: `Docker` (Render will use the provided `Dockerfile`).

### 2. Configure Environment Variables
You must supply the required variables from your `.env` file in the Render Dashboard:
- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GRAPH_API_TOKEN`
- `API_KEY`
- `ACCOUNTS_CONFIG`

Render automatically injects the `RENDER_EXTERNAL_URL`. The application dynamically uses this as the `PUBLIC_URL` if `PUBLIC_URL` is omitted.

### 3. Database Migration
When deploying for the first time, ensure the database schema is applied.
You can run this manually against your database or configure a build command:
```bash
npx prisma db push
```

## CI/CD Pipeline (GitHub Actions)

This repository includes a robust CI/CD pipeline out of the box.

### `.github/workflows/ci.yml`
Runs automatically on PRs and merges to `main`.
- Enforces code quality (ESLint).
- Validates typings (`tsc`).
- Runs unit, integration, and E2E simulation tests.
- Uploads test coverage.

### `.github/workflows/deploy.yml`
Handles continuous deployment natively.
To configure:
1. Go to your GitHub Repository Settings > Secrets and Variables > Actions.
2. Add `RENDER_DEPLOY_HOOK_URL`: The unique deploy hook URL found in your Render service settings.
3. Upon successfully pushing to `main` (and after passing CI), GitHub Actions will hit the hook to trigger a zero-downtime deployment.

## Deployment Health Verification

After deployment, verify the system is running:
1. **Health Check:** Visit `https://your-app.onrender.com/health`. You should receive a `200 OK` JSON response.
2. **Webhooks Check:** If configured, check your Telegram channel for the startup notification.
