#!/bin/bash
# Ultra-persistent WhatsApp service runner
# This script will keep the service running no matter what

SERVICE_DIR="/home/z/my-project/mini-services/whatsapp-service"
LOG_FILE="/tmp/whatsapp-service-persistent.log"
PID_FILE="/tmp/whatsapp-service.pid"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

cleanup() {
    log "Received shutdown signal"
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null
        rm -f "$PID_FILE"
    fi
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

log "=== Starting Persistent WhatsApp Service ==="

while true; do
    cd "$SERVICE_DIR"
    
    log "Starting service..."
    
    # Start the service
    npx tsx index.ts &
    SERVICE_PID=$!
    echo $SERVICE_PID > "$PID_FILE"
    
    # Wait for it to exit
    wait $SERVICE_PID
    EXIT_CODE=$?
    
    log "Service exited with code $EXIT_CODE"
    
    # Brief pause before restart
    sleep 2
done
