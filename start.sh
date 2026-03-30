#!/bin/sh
set -e

echo "=========================================="
echo "Starting WhatsApp Warmer Service"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="

# Ensure directories exist
mkdir -p /app/data /app/sessions /app/backups

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

# Wait for port 3030
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if nc -z localhost 3030 2>/dev/null; then
        echo "  ✅ Port 3030 is open!"
        break
    fi
    echo "  ⏳ Waiting for port 3030... ($i/30)"
    sleep 2
done

# Wait for health
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -s -f "http://localhost:3030/health" > /dev/null 2>&1; then
        echo "  ✅ WhatsApp service is healthy!"
        break
    fi
    echo "  ⏳ Waiting for health check... ($i/15)"
    sleep 2
done

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

# ==================== START NEXT.JS ====================

echo ""
echo "=========================================="
echo "Step 2: Starting Next.js Server"
echo "=========================================="

cd /app

echo "Starting Next.js server..."
node server.js &
NEXTJS_PID=$!
echo "Next.js PID: $NEXTJS_PID"

# Wait for port 3000
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if nc -z localhost 3000 2>/dev/null; then
        echo "  ✅ Port 3000 is open!"
        break
    fi
    echo "  ⏳ Waiting for port 3000... ($i/20)"
    sleep 2
done

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
        node server.js &
        NEXTJS_PID=$!
        echo "Next.js restarted with PID: $NEXTJS_PID"
    fi
    
    sleep 10
done
