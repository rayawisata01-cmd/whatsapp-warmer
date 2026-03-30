#!/bin/sh
set -e

echo "=========================================="
echo "Starting WhatsApp Warmer Service"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="

# Ensure directories exist
mkdir -p /app/data /app/sessions /app/backups

# Set DATABASE_URL explicitly for SQLite
export DATABASE_URL="file:/app/data/whatsapp.db"
echo "DATABASE_URL set to: $DATABASE_URL"

# Run database migrations
echo "Running Prisma migrations..."
cd /app
bunx prisma db push --skip-generate || true

# ==================== START WHATSAPP SERVICE ====================

echo ""
echo "Step 1: Starting WhatsApp Service on port 3030..."
cd /app/whatsapp-service
bun index.ts > /app/data/whatsapp-service.log 2>&1 &
WA_PID=$!
echo "WhatsApp Service PID: $WA_PID"

# Wait for WhatsApp service
for i in 1 2 3 4 5 6 7 8 9 10; do
  if nc -z localhost 3030 2>/dev/null; then
    echo "✅ WhatsApp service ready (port 3030)"
    break
  fi
  echo "Waiting for WhatsApp service... ($i/10)"
  sleep 2
done

# ==================== START NEXT.JS ====================

echo ""
echo "Step 2: Starting Next.js with custom server..."
cd /app
npx tsx server.ts &
NEXT_PID=$!
echo "Next.js PID: $NEXT_PID"

# Wait for Next.js
for i in 1 2 3 4 5 6 7 8 9 10; do
  if nc -z localhost 3000 2>/dev/null; then
    echo "✅ Next.js ready (port 3000)"
    break
  fi
  echo "Waiting for Next.js... ($i/10)"
  sleep 2
done

# ==================== TEST SOCKET.IO PROXY ====================

echo ""
echo "Step 3: Testing Socket.io proxy..."
echo "Direct WA service test:"
curl -s -o /dev/null -w "  HTTP %{http_code}" "http://localhost:3030/socket.io/?EIO=4&transport=polling"
echo ""

echo "Proxy test (via Next.js):"
curl -s -o /dev/null -w "  HTTP %{http_code}" "http://localhost:3000/api/socket.io?EIO=4&transport=polling"
echo ""

# ==================== FINAL STATUS ====================

echo ""
echo "=========================================="
echo "🚀 ALL SERVICES STARTED"
echo "=========================================="
echo "WhatsApp Service: http://localhost:3030 (PID: $WA_PID)"
echo "Next.js Server:   http://localhost:3000 (PID: $NEXT_PID)"
echo "Socket.io Proxy:  /api/socket.io → localhost:3030/socket.io"
echo "=========================================="

# Keep running
trap "kill $WA_PID $NEXT_PID 2>/dev/null; exit 0" SIGTERM SIGINT
while true; do
  if ! kill -0 $WA_PID 2>/dev/null; then
    echo "⚠️ WhatsApp service died, restarting..."
    cd /app/whatsapp-service
    bun index.ts > /app/data/whatsapp-service.log 2>&1 &
    WA_PID=$!
  fi
  if ! kill -0 $NEXT_PID 2>/dev/null; then
    echo "⚠️ Next.js died, restarting..."
    cd /app
    npx tsx server.ts &
    NEXT_PID=$!
  fi
  sleep 10
done
