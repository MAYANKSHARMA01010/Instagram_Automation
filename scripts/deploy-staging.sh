#!/usr/bin/env bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Staging Deployment...${NC}"

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found. Please create one based on .env.example.${NC}"
    exit 1
fi

echo -e "${YELLOW}1. Building Docker Images...${NC}"
docker compose build

echo -e "${YELLOW}2. Starting PostgreSQL Database...${NC}"
docker compose up -d db

echo -e "${YELLOW}3. Waiting for PostgreSQL to be healthy...${NC}"
# Wait for the DB to report 'healthy' via the healthcheck
ATTEMPTS=0
MAX_ATTEMPTS=30
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    STATUS=$(docker inspect --format='{{json .State.Health.Status}}' instagram_postgres 2>/dev/null || echo '"unknown"')
    if [ "$STATUS" = '"healthy"' ]; then
        echo -e "${GREEN}Database is healthy!${NC}"
        break
    fi
    echo "Waiting... ($STATUS)"
    sleep 2
    ATTEMPTS=$((ATTEMPTS+1))
done

if [ "$STATUS" != '"healthy"' ]; then
    echo -e "${RED}Error: Database failed to become healthy. Check logs with: docker compose logs db${NC}"
    exit 1
fi

echo -e "${YELLOW}4. Running Prisma Migrations...${NC}"
# Run prisma migrate deploy inside a temporary node container attached to the network
docker compose run --rm -e DATABASE_URL=postgresql://postgres:postgres@db:5432/instagram_automation?schema=public app npx prisma migrate deploy

echo -e "${YELLOW}5. Starting the App and remaining services...${NC}"
docker compose up -d

echo -e "${GREEN}Deployment sequence complete!${NC}"
echo -e "${YELLOW}Running Smoke Tests...${NC}"
./scripts/smoke-test.sh
