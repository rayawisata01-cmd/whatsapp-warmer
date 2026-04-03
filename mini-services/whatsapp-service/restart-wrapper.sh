#!/bin/bash
# WhatsApp Service Runner with Auto-Restart
# This script keeps the WhatsApp service running even if it crashes

SERVICE_DIR="/home/z/my-project/mini-services/whatsapp-service"
LOG_FILE="/tmp/whatsapp-service-runner.log"
MAX_RESTARTS=10
RESTART_WINDOW=60  # seconds
restart_count=0
last_restart=0

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "=== WhatsApp Service Runner Started ==="

cd "$SERVICE_DIR"

while true; do
    # Check if we need to reset restart counter
    now=$(date +%s)
    if [ $((now - last_restart)) -gt $RESTART_WINDOW ]; then
        restart_count=0
    fi
    
    # Check restart limit
    if [ $restart_count -ge $MAX_RESTARTS ]; then
        log "ERROR: Max restarts reached ($MAX_RESTARTS in $RESTART_WINDOW seconds). Waiting 60s..."
        sleep 60
        restart_count=0
        continue
    fi
    
    log "Starting WhatsApp service (attempt $((restart_count + 1)))..."
    
    # Run the service
    bun index.ts
    exit_code=$?
    
    log "Service exited with code $exit_code"
    
    # Update restart tracking
    restart_count=$((restart_count + 1))
    last_restart=$(date +%s)
    
    # Brief pause before restart
    sleep 2
done
