# WhatsApp Service Dockerfile
# Pure Node.js service with Baileys + Socket.io

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY prisma ./prisma/
RUN bun install --frozen-lockfile
RUN bunx prisma generate

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV BUN_INSTALL=/app/node_modules

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.prisma ./.prisma

# Copy source files
COPY . .

# Create sessions directory
RUN mkdir -p /app/sessions /app/backups

# Expose port
EXPOSE 3030

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3030/health || exit 1

# Start the service
CMD ["bun", "index.ts"]
