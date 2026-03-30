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

# Simple TCP port check (faster than HTTP for basic connectivity)
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

# Health check with retry (for HTTP endpoints)
# Args: $1 = service name, $2 = url, $3 = max attempts, $4 = delay seconds
wait_for_health() {
    SERVICE_NAME=$1
    HEALTH_URL=$2
    MAX_ATTEMPTS=$3
    DELAY=$4
    
    echo "Waiting for $SERVICE_NAME to be ready..."
    ATTEMPT=1
    
    while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
        echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS: Checking $HEALTH_URL..."
        
        # Use curl with timeout, return true if HTTP 200
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

# ==================== START NEXT.JS ====================

echo "Starting Next.js server..."
bun .next/standalone/server.js &
NEXTJS_PID=$!
echo "Next.js PID: $NEXTJS_PID"

# First wait for port to be open (faster check)
wait_for_port "localhost" 3000 30 1 || true

# Give Next.js extra time to fully initialize routes (cold start compilation)
echo "Waiting for Next.js routes to warm up..."
sleep 5

# Now check health endpoint (max 15 attempts after warmup)
# Note: Use || true to prevent script exit on failure (set -e is active)
wait_for_health "Next.js" "http://localhost:3000/api/wa/health" 15 2 || true

# ==================== START WHATSAPP SERVICE ====================

echo "Starting WhatsApp service with Node.js..."
echo "Working directory: /app/mini-services/whatsapp-service"
cd /app/mini-services/whatsapp-service

# Check if tsx is available
if ! command -v tsx &> /dev/null; then
    echo "⚠️ tsx not found, installing..."
    npm install -g tsx
fi

# Start WhatsApp service with output logging
# Use unbuffer (expect package) to prevent output buffering for real-time logs
# This ensures health check logs appear immediately, not after buffer flush
echo "Launching tsx index.ts..."
if command -v unbuffer &> /dev/null; then
    unbuffer npx tsx index.ts > /app/data/whatsapp-service.log 2>&1 &
else
    # Fallback: use stdbuf if available, otherwise regular redirect
    if command -v stdbuf &> /dev/null; then
        stdbuf -oL -eL npx tsx index.ts > /app/data/whatsapp-service.log 2>&1 &
    else
        npx tsx index.ts > /app/data/whatsapp-service.log 2>&1 &
    fi
fi
WA_PID=$!
echo "WhatsApp Service PID: $WA_PID"

# Wait a moment for the process to start
sleep 2

# Check if process is still running
if ! kill -0 $WA_PID 2>/dev/null; then
    echo "❌ WhatsApp service failed to start!"
    echo "=== WhatsApp Service Log ==="
    if [ -f /app/data/whatsapp-service.log ]; then
        cat /app/data/whatsapp-service.log
    else
        echo "No log file found"
    fi
    echo "=== End Log ==="
    exit 1
fi

echo "WhatsApp service started, waiting for it to be ready..."

# Wait for WhatsApp service to be healthy (max 30 attempts, 2s delay = 60s total)
WA_HEALTH_RESULT=0
wait_for_health "WhatsApp Service" "http://localhost:3030/health" 30 2 || WA_HEALTH_RESULT=$?

if [ $WA_HEALTH_RESULT -ne 0 ]; then
    echo "⚠️ WhatsApp service health check failed, checking logs..."
    if [ -f /app/data/whatsapp-service.log ]; then
        echo "=== Recent WhatsApp Service Logs ==="
        tail -50 /app/data/whatsapp-service.log
        echo "=== End Logs ==="
    fi
fi

# ==================== FINAL STATUS ====================

echo "=========================================="
echo "Service Status:"
echo "- Next.js (Bun): http://localhost:3000 (PID: $NEXTJS_PID)"
echo "- WhatsApp Service (Node.js): http://localhost:3030 (PID: $WA_PID)"
echo "=========================================="

# Function to handle process exit
handle_exit() {
    echo "Received shutdown signal..."
    
    # Check which process exited
    if ! kill -0 $NEXTJS_PID 2>/dev/null; then
        echo "Next.js process has exited"
    fi
    if ! kill -0 $WA_PID 2>/dev/null; then
        echo "WhatsApp service process has exited"
        # Show last logs
        if [ -f /app/data/whatsapp-service.log ]; then
            echo "=== Last WhatsApp Service Logs ==="
            tail -30 /app/data/whatsapp-service.log
        fi
    fi
    
    # Kill remaining processes
    kill $NEXTJS_PID $WA_PID 2>/dev/null || true
    exit 0
}

# Keep script running and handle signals
trap handle_exit SIGTERM SIGINT

# Wait for any process to exit
wait
