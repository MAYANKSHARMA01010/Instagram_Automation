# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cached layer)
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and compile TypeScript
COPY prisma/ ./prisma/
COPY tsconfig.json ./
COPY src/ ./src/

# Generate Prisma client before building
RUN npx prisma@5.22.0 generate
RUN pnpm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

WORKDIR /app

# Copy only production dependencies
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
COPY prisma/ ./prisma/
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
RUN npx prisma@5.22.0 generate

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy runtime files
COPY caption.txt ./caption.txt
COPY .env.example ./.env.example

# Create required directories with correct ownership
RUN mkdir -p logs database tmp public/cover && \
    chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Use dumb-init to handle PID 1 and signal forwarding
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
