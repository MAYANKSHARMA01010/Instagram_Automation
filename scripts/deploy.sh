#!/bin/bash

# Instagram Reels Automation - Deployment Script
# Usage: ./deploy.sh [environment]

ENV=${1:-production}
echo "Deploying to $ENV environment..."

# 1. Install dependencies
echo "Installing dependencies..."
pnpm install --frozen-lockfile

# 2. Generate Prisma Client
echo "Generating Prisma Client..."
npx prisma generate

# 3. Push Database Schema
echo "Pushing database schema..."
npx prisma db push --accept-data-loss

# 4. Build TypeScript
echo "Building project..."
pnpm run build

# 5. Restart Process Manager (e.g., PM2)
echo "Restarting application..."
# pm2 restart instagram-automation

echo "Deployment complete!"
