#!/usr/bin/env bash
# =============================================================================
# Instagram Reels Uploader - One-Click Setup Script
# =============================================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m" # No Color

info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
heading() { echo -e "\n${BOLD}$*${NC}"; }

heading "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
heading "  Instagram Reels Uploader - Setup Script"
heading "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Check Node.js version
heading "Checking prerequisites..."
NODE_VERSION=$(node -v 2>/dev/null | grep -oP '\d+' | head -1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js 20+ is required. Current: $(node -v 2>/dev/null || echo 'not found')"
fi
info "Node.js $(node -v) ✓"

# 2. Check npm
npm -v > /dev/null 2>&1 || error "npm is not installed"
info "npm $(npm -v) ✓"

# 3. Check Docker (optional)
if command -v docker &>/dev/null; then
  info "Docker $(docker -v | grep -oP '\d+\.\d+\.\d+' | head -1) ✓"
else
  warn "Docker not found. You can run the app without Docker, but it's recommended."
fi

# 4. Create .env from example
heading "Setting up environment..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    info ".env created from .env.example"
    warn "⚠️  Please edit .env and add your credentials before starting"
  else
    error ".env.example not found. Are you in the project root?"
  fi
else
  info ".env already exists ✓"
fi

# 5. Create required directories
heading "Creating directories..."
mkdir -p logs database tmp public/cover n8n
info "Directories created ✓"

# 6. Create placeholder cover image note
if [ ! -f "public/cover/.gitkeep" ]; then
  touch public/cover/.gitkeep
  echo "# Place your cover.jpg file in this directory" > public/cover/README.txt
fi

# 7. Install npm dependencies
heading "Installing dependencies..."
npm install
info "Dependencies installed ✓"

# 8. Compile TypeScript
heading "Building TypeScript..."
npm run build
info "TypeScript compiled ✓"

# 9. Print next steps
heading "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BOLD}Setup complete! Next steps:${NC}"
echo ""
echo "  1. Edit your .env file with your credentials:"
echo "     nano .env"
echo ""
echo "  2. Get your Google OAuth refresh token:"
echo "     node scripts/get-refresh-token.js"
echo ""
echo "  3. Add your cover image to:"
echo "     public/cover/cover.jpg"
echo ""
echo "  4. Edit your caption:"
echo "     nano caption.txt"
echo ""
echo "  5. Start with Docker:"
echo "     docker-compose up -d"
echo ""
echo "  Or start without Docker:"
echo "     npm start"
echo ""
echo "  6. Import n8n workflow:"
echo "     Open http://localhost:5678 → Import → n8n/workflow.json"
echo ""
heading "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
