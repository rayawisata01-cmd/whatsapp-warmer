# Railway Volume Setup Guide

## Why Volumes are Needed

Railway containers are **ephemeral** - all files are lost on redeploy.
To persist data, you MUST mount volumes.

## Required Volumes

| Mount Path | Purpose | Recommended Size |
|------------|---------|------------------|
| `/app/db` | SQLite database (personalities, accounts, logs) | 1 GB |
| `/app/mini-services/whatsapp-service/sessions` | WhatsApp auth sessions | 1 GB |
| `/app/mini-services/whatsapp-service/backups` | Session backups | 500 MB |

## Setup via Railway Dashboard

### Step 1: Create Volume for Database
1. Go to your Service → **Volumes** tab
2. Click **+ New Volume**
3. Set Mount Path: `/app/db`
4. Set Size: `1 GB`
5. Click **Add Volume**

### Step 2: Create Volume for Sessions
1. Click **+ New Volume** again
2. Set Mount Path: `/app/mini-services/whatsapp-service/sessions`
3. Set Size: `1 GB`
4. Click **Add Volume**

### Step 3: Create Volume for Backups (Optional)
1. Click **+ New Volume** again
2. Set Mount Path: `/app/mini-services/whatsapp-service/backups`
3. Set Size: `500 MB`
4. Click **Add Volume**

## Verify Volumes

After setup, you should see:

```
Volumes
├── volume-xxx-xxx (db) → /app/db
├── volume-yyy-yyy (sessions) → /app/mini-services/whatsapp-service/sessions
└── volume-zzz-zzz (backups) → /app/mini-services/whatsapp-service/backups
```

## Free Tier Limits

- Railway Free Tier: **5 GB** total storage
- Each service: Up to **3 volumes**
- Our setup uses: 2.5 GB (within free tier)

## Troubleshooting

### "Database is empty after redeploy"
- Check if volume is properly mounted at `/app/db`
- Verify in Railway dashboard → Volumes tab

### "WhatsApp sessions lost after redeploy"
- Check if volume is mounted at `/app/mini-services/whatsapp-service/sessions`
- Sessions contain auth credentials - losing them means re-scan QR!

### "Volume mount failed"
- Ensure path starts with `/app/`
- Check Railway logs for mount errors
