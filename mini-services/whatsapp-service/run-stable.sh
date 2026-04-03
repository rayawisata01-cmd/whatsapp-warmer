#!/bin/bash
# Stable runner for WhatsApp service

cd /home/z/my-project/mini-services/whatsapp-service

LOG_FILE="/tmp/wa-service.log"

echo "$(date): Starting WhatsApp service..." >> "$LOG_FILE"

while true; do
    echo "$(date): Running bun index.ts..." >> "$LOG_FILE"

    # Run with error capture
    bun index.ts 2>&1 | tee -a "$LOG_FILE"
    EXIT_CODE=$?

    echo "$(date): Service exited with code $EXIT_CODE" >> "$LOG_FILE"

    # Wait before restart
    sleep 2
done
