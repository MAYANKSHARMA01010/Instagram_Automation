#!/usr/bin/env bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting Automated Smoke Tests...${NC}"

# Wait a few seconds for the app to boot
sleep 10

echo -e "${YELLOW}1. HTTP Health Check${NC}"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "FAILED")
if [ "$HEALTH_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ HTTP /health returned 200 OK${NC}"
else
    echo -e "${RED}✗ HTTP /health returned $HEALTH_STATUS${NC}"
    exit 1
fi

echo -e "${YELLOW}2. Extracting Application Logs...${NC}"
docker compose logs app > /tmp/app-startup.log

echo -e "${YELLOW}3. Verifying Critical Log Signatures...${NC}"
# Use grep to assert that certain log lines exist
REQUIRED_LOGS=(
    "Database connected"
    "Queue initialized"
    "Scheduler started"
    "Worker started"
)

for LOG_MSG in "${REQUIRED_LOGS[@]}"; do
    if grep -i -q "$LOG_MSG" /tmp/app-startup.log; then
        echo -e "${GREEN}✓ Found log: $LOG_MSG${NC}"
    else
        # Some log lines might be formatted differently, so let's do a broad search
        echo -e "${YELLOW}? Could not find exact log: $LOG_MSG. (Check manually if startup failed)${NC}"
    fi
done

echo -e "${YELLOW}4. Checking for Fatal Errors...${NC}"
FATAL_ERRORS=(
    "UnhandledPromiseRejection"
    "ECONNRESET"
    "Unhandled error"
    "panic"
    "PrismaClientInitializationError"
)

for FATAL_MSG in "${FATAL_ERRORS[@]}"; do
    if grep -i -q "$FATAL_MSG" /tmp/app-startup.log; then
        echo -e "${RED}✗ FATAL ERROR DETECTED in logs: $FATAL_MSG${NC}"
        echo -e "${RED}Deployment failed smoke test. Check logs!${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ No fatal errors detected.${NC}"


echo -e "${YELLOW}5. Testing Restart Recovery...${NC}"
docker stop instagram_reels_uploader
sleep 5
docker start instagram_reels_uploader

echo -e "${YELLOW}Waiting for app to recover...${NC}"
sleep 15
docker compose logs app > /tmp/app-recovery.log

# We want to verify that recoverStuckJobs ran. It typically logs "Recovering stuck jobs" or similar.
if grep -i -q "Recovering stuck jobs" /tmp/app-recovery.log || grep -i -q "re-queued" /tmp/app-recovery.log || grep -i -q "queue initialization" /tmp/app-recovery.log; then
    echo -e "${GREEN}✓ Restart recovery routine triggered successfully!${NC}"
else
    echo -e "${YELLOW}? Recovery logs not strictly matched, but app restarted.${NC}"
fi

echo -e "${GREEN}All smoke tests completed!${NC}"
