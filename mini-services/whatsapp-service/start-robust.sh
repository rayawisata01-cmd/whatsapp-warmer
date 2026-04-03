#!/bin/bash
# Robust startup script for WhatsApp service

cd /home/z/my-project/mini-services/whatsapp-service

while true; do
    echo "$(date): Starting service..." >> /tmp/wa-service.log
    bun index.ts >> /tmp/wa-service.log 2>&1
    EXIT_CODE=$?
    echo "$(date): Service exited with code $EXIT_CODE" >> /tmp/wa-service.log
    sleep 2
done
