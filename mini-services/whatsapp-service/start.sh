#!/bin/bash
# Persistent WhatsApp service wrapper
# This script ensures the WhatsApp service stays running

cd /home/z/my-project/mini-services/whatsapp-service

LOG_FILE="/tmp/whatsapp-service.log"
PID_FILE="/tmp/whatsapp-service.pid"

# Cleanup function
cleanup() {
    echo "[$(date)] Stopping WhatsApp service..." >> "$LOG_FILE"
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null
        rm -f "$PID_FILE"
    fi
    exit 0
}

trap cleanup SIGTERM SIGINT

echo "[$(date)] Starting WhatsApp service monitor..." >> "$LOG_FILE"

while true; do
    echo "[$(date)] Starting WhatsApp service..." >> "$LOG_FILE"
    
    # Start the service
    npx tsx index.ts >> "$LOG_FILE" 2>&1 &
    SERVICE_PID=$!
    echo $SERVICE_PID > "$PID_FILE"
    
    # Wait for it to exit
    wait $SERVICE_PID
    EXIT_CODE=$?
    
    echo "[$(date)] Service exited with code $EXIT_CODE" >> "$LOG_FILE"
    
    # Small delay before restart
    sleep 2
done
