#!/bin/bash
# Persistent wrapper for WhatsApp service
cd /home/z/my-project/mini-services/whatsapp-service

echo "[$(date)] Starting WhatsApp service monitor..."

while true; do
    echo "[$(date)] Starting service..."
    npx tsx index.ts 2>&1
    EXIT_CODE=$?
    echo "[$(date)] Service exited with code $EXIT_CODE"
    echo "[$(date)] Restarting in 2 seconds..."
    sleep 2
done
