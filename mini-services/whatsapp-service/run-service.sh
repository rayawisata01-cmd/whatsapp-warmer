#!/bin/bash
cd /home/z/my-project/mini-services/whatsapp-service
while true; do
  echo "Starting WhatsApp service..."
  bun index.ts
  EXIT_CODE=$?
  echo "Service exited with code $EXIT_CODE, restarting in 3 seconds..."
  sleep 3
done
