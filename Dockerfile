# Combined Dockerfile - Next.js + WhatsApp Service in ONE container
# This runs both services using start.sh with custom server for WebSocket proxy

FROM oven/bun:1-alpine AS base

WORKDIR /app

# Install dependencies including tsx for custom server
RUN apk add --no-cache \
    nodejs \
    npm \
    curl \
    netcat-openbsd

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Create directories
RUN mkdir -p /app/data /app/sessions /app/backups && chmod 777 /app/data /app/sessions /app/backups

# ========== DEPS STAGE ==========
FROM base AS deps

# Copy root package files
COPY package.json bun.lock ./
COPY prisma ./prisma

# Install root dependencies
RUN bun install --frozen-lockfile
RUN bunx prisma generate

# ========== BUILDER STAGE ==========
FROM base AS builder

# Copy node_modules from deps
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY . .

# Set database URL for build
ENV DATABASE_URL="file:/app/data/whatsapp.db"

# Build Next.js
RUN bun run build

# ========== RUNNER STAGE ==========
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/whatsapp.db"

# Copy Next.js built files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy node_modules and prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Copy custom server for WebSocket proxy support
COPY --from=builder /app/server.ts ./server.ts

# Copy whatsapp-service source files
COPY whatsapp-service/index.ts ./whatsapp-service/index.ts
COPY whatsapp-service/package.json ./whatsapp-service/package.json
COPY whatsapp-service/db.ts ./whatsapp-service/db.ts
COPY whatsapp-service/config.json ./whatsapp-service/config.json
COPY whatsapp-service/prisma ./whatsapp-service/prisma

# Install whatsapp-service dependencies
RUN cd /app/whatsapp-service && bun install && bunx prisma generate

# Copy start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Ensure directories exist
RUN mkdir -p /app/data /app/sessions /app/backups && chmod 777 /app/data /app/sessions /app/backups

EXPOSE 3000 3030

ENV PORT=3000
ENV WHATSAPP_SERVICE_PORT=3030

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/wa/health || exit 1

# Start both services with custom server
CMD ["./start.sh"]
