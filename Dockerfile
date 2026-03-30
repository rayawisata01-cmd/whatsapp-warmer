# Next.js Service Dockerfile (Frontend + API Proxy)
# This service connects to whatsapp-service via Railway Private Network

FROM oven/bun:1-alpine AS base

WORKDIR /app

# Install dependencies
RUN apk add --no-cache \
    nodejs \
    npm \
    curl

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Create data directory for SQLite
RUN mkdir -p /app/data && chmod 777 /app/data

# Copy package files
FROM base AS deps
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy prisma and generate
COPY prisma ./prisma
RUN bunx prisma generate

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.prisma ./.prisma
COPY . .

# Set database URL for build
ENV DATABASE_URL="file:/app/data/whatsapp.db"

# Build Next.js
RUN bun run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/whatsapp.db"

# Don't run as root
# RUN addgroup --system --gid 1001 nodejs
# RUN adduser --system --uid 1001 nextjs

# Copy built files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.prisma ./.prisma
COPY --from=builder /app/prisma ./prisma

# Ensure data directory exists with write permissions
RUN mkdir -p /app/data && chmod 777 /app/data

EXPOSE 3000

ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/api/wa/health || exit 1

# Start Next.js server
CMD ["node", "server.js"]
