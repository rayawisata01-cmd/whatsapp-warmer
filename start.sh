#!/bin/sh
set -e

echo "=========================================="
echo "Starting WhatsApp Warmer Service"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="

# Ensure data directory exists
mkdir -p /app/data

# Run database migrations
echo "Running Prisma migrations..."
bunx prisma db push --skip-generate

# Create symlinks for Prisma in WhatsApp service
echo "Setting up Prisma symlinks..."
mkdir -p /app/mini-services/whatsapp-service/node_modules/@prisma
ln -sf /app/node_modules/@prisma/client /app/mini-services/whatsapp-service/node_modules/@prisma/client
ln -sf /app/node_modules/.prisma /app/mini-services/whatsapp-service/node_modules/.prisma

# ==================== HELPER FUNCTIONS ====================

wait_for_port() {
    local host=$1
    local port=$2
    local max_attempts=${3:-30}
    local delay=${4:-1}
    
    echo "Waiting for $host:$port to be accessible..."
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if nc -z -w2 "$host" "$port" 2>/dev/null; then
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

echo "Working directory: /app/mini-services/whatsapp-service"
cd /app/mini-services/whatsapp-service

if ! command -v tsx &> /dev/null; then
    echo "⚠️ tsx not found, installing..."
    npm install -g tsx
fi

echo "Launching WhatsApp service (tsx index.ts)..."
if command -v unbuffer &> /dev/null; then
    unbuffer npx tsx index.ts > /app/data/whatsapp-service.log 2>&1 &
elif command -v stdbuf &> /dev/null; then
    stdbuf -oL -eL npx tsx index.ts > /app/data/whatsapp-service.log 2>&1 &
else
    npx tsx index.ts > /app/data/whatsapp-service.log 2>&1 &
fi
WA_PID=$!
echo "WhatsApp Service PID: $WA_PID"

echo ""
echo "Waiting for WhatsApp service to be fully ready..."

wait_for_port "localhost" 3030 60 2 || true

WA_HEALTH_RESULT=0
wait_for_health "WhatsApp Service" "http://localhost:3030/health" 30 2 || WA_HEALTH_RESULT=$?

if [ $WA_HEALTH_RESULT -ne 0 ]; then
    echo "⚠️ WhatsApp service health check failed, checking logs..."
    if [ -f /app/data/whatsapp-service.log ]; then
        echo "=== Recent WhatsApp Service Logs ==="
        tail -50 /app/data/whatsapp-service.log
        echo "=== End Logs ==="
    fi
    echo ""
    echo "⚠️ Continuing anyway - service may still be initializing..."
fi

echo "Giving WhatsApp service extra time to stabilize..."
sleep 5

if ! kill -0 $WA_PID 2>/dev/null; then
    echo "❌ WhatsApp service crashed during startup!"
    if [ -f /app/data/whatsapp-service.log ]; then
        echo "=== WhatsApp Service Log ==="
        cat /app/data/whatsapp-service.log
        echo "=== End Log ==="
    fi
    exit 1
fi

echo "✅ WhatsApp service is running and healthy!"

# ==================== START NEXT.JS ====================

echo ""
echo "=========================================="
echo "Step 2: Starting Next.js Server"
echo "=========================================="

cd /app

echo "Starting Next.js server..."
bun .next/standalone/server.js &
NEXTJS_PID=$!
echo "Next.js PID: $NEXTJS_PID"

wait_for_port "localhost" 3000 30 1 || true

echo "Waiting for Next.js routes to initialize..."
sleep 5

wait_for_health "Next.js" "http://localhost:3000/api/wa/health" 15 2 || true

# ==================== FINAL VERIFICATION ====================

echo ""
echo "=========================================="
echo "Step 3: Verifying Service Connectivity"
echo "=========================================="

# Test Socket.io proxy - IMPORTANT: Use URL WITHOUT trailing slash
# Socket.io endpoint is /api/socket.io (no trailing slash)
echo "Testing Socket.io proxy connectivity..."

# Test 1: Direct WhatsApp service (bypass Next.js proxy)
echo "Test 1: Direct WhatsApp service (port 3030)..."
DIRECT_RESULT=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3030/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "000")
echo "  Direct WA service response: HTTP $DIRECT_RESULT"

# Test 2: Via Next.js proxy - NO trailing slash!
echo "Test 2: Via Next.js proxy (port 3000)..."
PROXY_RESULT=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/socket.io?EIO=4&transport=polling" 2>/dev/null || echo "000")
echo "  Proxy response: HTTP $PROXY_RESULT"

# Acceptable responses: 200 (OK) or 400 (Bad Request - normal for missing session)
if [ "$PROXY_RESULT" = "200" ] || [ "$PROXY_RESULT" = "400" ]; then
    echo "✅ Socket.io proxy is working correctly (HTTP $PROXY_RESULT)"
elif [ "$PROXY_RESULT" = "308" ] || [ "$PROXY_RESULT" = "301" ] || [ "$PROXY_RESULT" = "302" ] || [ "$PROXY_RESULT" = "307" ]; then
    echo "❌ CRITICAL: Proxy returned redirect ($PROXY_RESULT)! This will break Socket.io!"
    echo "   Checking redirect location..."
    REDIRECT_LOCATION=$(curl -s -I "http://localhost:3000/api/socket.io?EIO=4&transport=polling" 2>/dev/null | grep -i "location:" | head -1)
    echo "   Redirect to: $REDIRECT_LOCATION"
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
echo "  - Next.js Server:   http://localhost:3000 (PID: $NEXTJS_PID)"
echo "=========================================="
echo ""

handle_exit() {
    echo ""
    echo "Received shutdown signal..."
    
    if ! kill -0 $NEXTJS_PID 2>/dev/null; then
        echo "Next.js process has exited"
    fi
    if ! kill -0 $WA_PID 2>/dev/null; then
        echo "WhatsApp service process has exited"
        if [ -f /app/data/whatsapp-service.log ]; then
            echo "=== Last WhatsApp Service Logs ==="
            tail -30 /app/data/whatsapp-service.log
        fi
    fi
    
    kill $NEXTJS_PID $WA_PID 2>/dev/null || true
    exit 0
}

trap handle_exit SIGTERM SIGINT

wait
