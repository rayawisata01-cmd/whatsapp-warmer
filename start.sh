#!/bin/sh
set -e

echo "=========================================="
echo "Starting WhatsApp Warmer Service"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="

# Ensure directories exist
mkdir -p /app/data /app/mini-services/whatsapp-service/sessions /app/mini-services/whatsapp-service/backups

# Set DATABASE_URL explicitly for SQLite
export DATABASE_URL="file:/app/data/whatsapp.db"
echo "DATABASE_URL: $DATABASE_URL"

# Run database migrations
echo "Running Prisma migrations..."
cd /app
bunx prisma db push --skip-generate || true

# Create symlinks for Prisma in WhatsApp service
echo "Setting up Prisma symlinks..."
mkdir -p /app/mini-services/whatsapp-service/node_modules/@prisma
ln -sf /app/node_modules/@prisma/client /app/mini-services/whatsapp-service/node_modules/@prisma/client 2>/dev/null || true
ln -sf /app/node_modules/.prisma /app/mini-services/whatsapp-service/node_modules/.prisma 2>/dev/null || true

# ==================== STEP 1: START WHATSAPP SERVICE FIRST ====================

echo ""
echo "=========================================="
echo "STEP 1: Starting WhatsApp Service"
echo "=========================================="
echo ""

cd /app/mini-services/whatsapp-service

# Check if tsx is available
if ! command -v tsx &> /dev/null; then
    echo "Installing tsx..."
    npm install -g tsx
fi

# Start WhatsApp service
echo "Starting WhatsApp service on port 3030..."

# CRITICAL: Log to BOTH file AND stdout using tee
# This ensures Railway captures logs while also keeping file backup
if command -v unbuffer &> /dev/null; then
    unbuffer npx tsx index.ts 2>&1 | tee /app/data/whatsapp-service.log &
elif command -v stdbuf &> /dev/null; then
    stdbuf -oL -eL npx tsx index.ts 2>&1 | tee /app/data/whatsapp-service.log &
else
    npx tsx index.ts 2>&1 | tee /app/data/whatsapp-service.log &
fi
WA_PID=$!
echo "WhatsApp Service PID: $WA_PID"

# Wait for WhatsApp service to be ready
echo "Waiting for WhatsApp service to start..."
WA_READY=0
for i in $(seq 1 60); do
    # Check TCP port
    if nc -z localhost 3030 2>/dev/null; then
        echo "✅ Port 3030 is open"
        
        # Check if Socket.io responds
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3030/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "000")
        
        if [ "$HTTP_CODE" = "200" ]; then
            echo "✅ Socket.io endpoint responding (HTTP 200)"
            WA_READY=1
            break
        else
            echo "  Waiting for Socket.io... (HTTP $HTTP_CODE)"
        fi
    fi
    
    # Check if process died
    if ! kill -0 $WA_PID 2>/dev/null; then
        echo "❌ WhatsApp service died during startup!"
        echo "=== Last 50 lines of log ==="
        tail -50 /app/data/whatsapp-service.log 2>/dev/null || echo "No log available"
        echo "=== End of log ==="
        exit 1
    fi
    
    echo "  Waiting... ($i/60)"
    sleep 2
done

if [ $WA_READY -eq 0 ]; then
    echo "⚠️ WhatsApp service not fully ready after 2 minutes, but continuing..."
fi

# Test Socket.io endpoint
echo ""
echo "Testing Socket.io endpoint:"
RESPONSE=$(curl -s "http://localhost:3030/socket.io/?EIO=4&transport=polling" 2>/dev/null | head -c 200)
echo "Response: $RESPONSE"
echo ""

# ==================== STEP 2: START NEXT.JS WITH CUSTOM SERVER ====================

echo ""
echo "=========================================="
echo "STEP 2: Starting Next.js Custom Server"
echo "=========================================="
echo ""

cd /app

echo "Starting Next.js server on port 3000..."
npx tsx server.ts 2>&1 | tee /app/data/nextjs-server.log &
NEXT_PID=$!
echo "Next.js PID: $NEXT_PID"

# Wait for Next.js
echo "Waiting for Next.js to start..."
NEXT_READY=0
for i in $(seq 1 60); do
    if nc -z localhost 3000 2>/dev/null; then
        echo "✅ Port 3000 is open"
        NEXT_READY=1
        break
    fi
    
    if ! kill -0 $NEXT_PID 2>/dev/null; then
        echo "❌ Next.js server died during startup!"
        echo "=== Last 50 lines of log ==="
        tail -50 /app/data/nextjs-server.log 2>/dev/null || echo "No log available"
        echo "=== End of log ==="
        exit 1
    fi
    
    echo "  Waiting... ($i/60)"
    sleep 2
done

if [ $NEXT_READY -eq 0 ]; then
    echo "⚠️ Next.js not ready after 2 minutes"
fi

# ==================== STEP 3: VERIFY PROXY ====================

echo ""
echo "=========================================="
echo "STEP 3: Verifying Socket.io Proxy"
echo "=========================================="
echo ""

echo "1. Direct WA Service (port 3030):"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3030/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "000")
RESPONSE=$(curl -s "http://localhost:3030/socket.io/?EIO=4&transport=polling" 2>/dev/null | head -c 100)
echo "   HTTP: $HTTP_CODE"
echo "   Response: $RESPONSE..."
echo ""

echo "2. Via Next.js Proxy /socket.io (port 3000):"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "000")
RESPONSE=$(curl -s "http://localhost:3000/socket.io/?EIO=4&transport=polling" 2>/dev/null | head -c 100)
echo "   HTTP: $HTTP_CODE"
echo "   Response: $RESPONSE..."
echo ""

echo "3. Via Next.js Proxy /api/socket.io (legacy):"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/socket.io?EIO=4&transport=polling" 2>/dev/null || echo "000")
RESPONSE=$(curl -s "http://localhost:3000/api/socket.io?EIO=4&transport=polling" 2>/dev/null | head -c 100)
echo "   HTTP: $HTTP_CODE"
echo "   Response: $RESPONSE..."
echo ""

# ==================== FINAL STATUS ====================

echo "=========================================="
echo "🚀 ALL SERVICES STARTED"
echo "=========================================="
echo ""
echo "Process IDs:"
echo "  WhatsApp Service: $WA_PID (port 3030)"
echo "  Next.js Server:   $NEXT_PID (port 3000)"
echo ""
echo "Socket.io Endpoints:"
echo "  ✅ /socket.io      → WA service (RECOMMENDED)"
echo "  ✅ /api/socket.io  → WA service (legacy compat)"
echo ""
echo "Verification Checklist:"
echo "  [ ] Direct WA service returns HTTP 200"
echo "  [ ] Proxy /socket.io returns HTTP 200"
echo "  [ ] Browser console shows 'Socket.io Connected'"
echo "  [ ] QR code appears after adding account"
echo "  [ ] QR scan triggers auth success (not Stream Errored)"
echo ""
echo "=========================================="

# Keep running with health checks
trap "echo 'Shutting down...'; kill $WA_PID $NEXT_PID 2>/dev/null; exit 0" SIGTERM SIGINT

while true; do
    # Check WhatsApp service
    if ! kill -0 $WA_PID 2>/dev/null; then
        echo "⚠️ WhatsApp service died, restarting..."
        cd /app/mini-services/whatsapp-service
        npx tsx index.ts 2>&1 | tee /app/data/whatsapp-service.log &
        WA_PID=$!
    fi

    # Check Next.js
    if ! kill -0 $NEXT_PID 2>/dev/null; then
        echo "⚠️ Next.js died, restarting..."
        cd /app
        npx tsx server.ts 2>&1 | tee /app/data/nextjs-server.log &
        NEXT_PID=$!
    fi
    
    # Periodic health check
    sleep 30
    
    if nc -z localhost 3030 2>/dev/null && nc -z localhost 3000 2>/dev/null; then
        echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') - Services healthy"
    else
        echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') - ⚠️ Service health check failed!"
    fi
done
