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

# ==================== HELPER FUNCTIONS ====================

wait_for_port() {
    local host=$1
    local port=$2
    local max_attempts=${3:-30}
    local delay=${4:-1}
    
    echo "Waiting for $host:$port to be accessible..."
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if nc -z -w2 "$host" "$port" 2>/dev/null 2>&1; then
            echo "  ✅ Port $port is open!"
            return 0
        fi
        echo "  ⏳ Attempt $attempt/$max_attempts: Port $port not ready, waiting ${delay}s..."
        sleep $delay
        attempt=$((attempt + 1))
    done
    
    echo "  ⚠️ Port $port not accessible after $max_attempts attempts"
    return 1
}

wait_for_health() {
    SERVICE_NAME=$1
    HEALTH_URL=$2
    MAX_ATTEMPTS=$3
    DELAY=$4
    
    echo "Waiting for $SERVICE_NAME to be ready..."
    ATTEMPT=1
    
    while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
        echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS: Checking $HEALTH_URL..."
        
        if curl -s -f -m 5 "$HEALTH_URL" > /dev/null 2>&1; then
            echo "  ✅ $SERVICE_NAME is ready!"
            return 0
        fi
        
        echo "  ⏳ $SERVICE_NAME not ready yet, waiting ${DELAY}s..."
        sleep $DELAY
        ATTEMPT=$((ATTEMPT + 1))
    done
    
    echo "  ⚠️ $SERVICE_NAME health check failed after $MAX_ATTEMPTS attempts, continuing anyway..."
    return 1
}

# ==================== START WHATSAPP SERVICE FIRST ====================

echo ""
echo "=========================================="
echo "Step 1: Starting WhatsApp Service"
echo "=========================================="

echo "Working directory: /app/whatsapp-service"
cd /app/whatsapp-service

echo "Launching WhatsApp service..."
bun index.ts > /app/data/whatsapp-service.log 2>&1 &
WA_PID=$!
echo "WhatsApp Service PID: $WA_PID"

echo ""
echo "Waiting for WhatsApp service to be fully ready..."

wait_for_port "localhost" 3030 60 2 || true
wait_for_health "WhatsApp Service" "http://localhost:3030/health" 30 2 || true

if ! kill -0 $WA_PID 2>/dev/null; then
    echo "❌ WhatsApp service crashed during startup!"
    if [ -f /app/data/whatsapp-service.log ]; then
        echo "=== WhatsApp Service Log ==="
        tail -100 /app/data/whatsapp-service.log
        echo "=== End Log ==="
    fi
    exit 1
fi

echo "✅ WhatsApp service is running!"

# ==================== START NEXT.JS WITH CUSTOM SERVER ====================

echo ""
echo "=========================================="
echo "Step 2: Starting Next.js (Custom Server)"
echo "=========================================="

cd /app

# CRITICAL: Use custom server for WebSocket proxy support
echo "Starting Next.js with custom server (WebSocket proxy enabled)..."
echo "Custom server: /app/server.ts"

# Run the custom server using tsx (supports TypeScript)
npx tsx server.ts &
NEXTJS_PID=$!
echo "Next.js PID: $NEXTJS_PID"

wait_for_port "localhost" 3000 30 2 || true

echo "Waiting for Next.js routes to initialize..."
sleep 5

wait_for_health "Next.js" "http://localhost:3000/api/wa/health" 15 2 || true

# ==================== FINAL VERIFICATION ====================

echo ""
echo "=========================================="
echo "Step 3: Verifying Service Connectivity"
echo "=========================================="

# Test Socket.io proxy
echo "Testing Socket.io proxy connectivity..."

# Test 1: Direct WhatsApp service (bypass Next.js proxy)
echo "Test 1: Direct WhatsApp service (port 3030)..."
DIRECT_RESULT=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3030/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "000")
echo "  Direct WA service response: HTTP $DIRECT_RESULT"

# Test 2: Via Next.js custom server proxy
echo "Test 2: Via Next.js custom server proxy (port 3000)..."
PROXY_RESULT=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/socket.io?EIO=4&transport=polling" 2>/dev/null || echo "000")
echo "  Proxy response: HTTP $PROXY_RESULT"

# Acceptable responses: 200 (OK) or 400 (Bad Request - normal for missing session)
if [ "$PROXY_RESULT" = "200" ] || [ "$PROXY_RESULT" = "400" ]; then
    echo "✅ Socket.io proxy is working correctly (HTTP $PROXY_RESULT)"
elif [ "$PROXY_RESULT" = "308" ] || [ "$PROXY_RESULT" = "301" ] || [ "$PROXY_RESULT" = "302" ] || [ "$PROXY_RESULT" = "307" ]; then
    echo "❌ CRITICAL: Proxy returned redirect ($PROXY_RESULT)! This will break Socket.io!"
else
    echo "⚠️ Socket.io proxy returned HTTP $PROXY_RESULT (unexpected)"
fi

# ==================== FINAL STATUS ====================

echo ""
echo "=========================================="
echo "🚀 ALL SERVICES STARTED"
echo "=========================================="
echo "Service Status:"
echo "  - WhatsApp Service: http://localhost:3030 (PID: $WA_PID)"
echo "  - Next.js Custom Server: http://localhost:3000 (PID: $NEXTJS_PID)"
echo "  - WebSocket Proxy: ENABLED (via http-proxy-middleware)"
echo "=========================================="
echo ""

handle_exit() {
    echo ""
    echo "Received shutdown signal..."
    kill $NEXTJS_PID $WA_PID 2>/dev/null || true
    exit 0
}

trap handle_exit SIGTERM SIGINT

# Keep script running and monitor processes
while true; do
    if ! kill -0 $WA_PID 2>/dev/null; then
        echo "❌ WhatsApp service died! Restarting..."
        cd /app/whatsapp-service
        bun index.ts > /app/data/whatsapp-service.log 2>&1 &
        WA_PID=$!
        echo "WhatsApp Service restarted with PID: $WA_PID"
    fi
    
    if ! kill -0 $NEXTJS_PID 2>/dev/null; then
        echo "❌ Next.js died! Restarting..."
        cd /app
        npx tsx server.ts &
        NEXTJS_PID=$!
        echo "Next.js restarted with PID: $NEXTJS_PID"
    fi
    
    sleep 10
done
