# Railway PostgreSQL Setup Guide

## Why PostgreSQL?

Railway containers are **ephemeral** - all files are lost on redeploy.
Using Railway's PostgreSQL service provides:
- ✅ Persistent database (auto-backed up)
- ✅ No volume management needed
- ✅ Scalable and production-ready
- ✅ Automatic DATABASE_URL injection

## Setup Steps

### Step 1: Add PostgreSQL Service in Railway

1. Go to your Railway Project
2. Click **+ New Service**
3. Select **Database** → **PostgreSQL**
4. Railway will auto-create and inject `DATABASE_URL`

### Step 2: Link Services

1. Go to your **WhatsApp Warmer** service
2. Click **Variables** tab
3. Click **Add Variable** → **Add Reference**
4. Select `DATABASE_URL` from PostgreSQL service
5. Railway will automatically inject the connection string

### Step 3: Deploy

1. Push to GitHub (main branch)
2. Railway will auto-deploy
3. Migration will run automatically on startup

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         RAILWAY                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────┐                │
│  │ WhatsApp Warmer  │      │    PostgreSQL    │                │
│  │    (Service)     │─────▶│    (Service)     │                │
│  │                  │      │                  │                │
│  │ - Next.js App    │      │ - Database       │                │
│  │ - WhatsApp Svc   │      │ - Personalities  │                │
│  │ - Sessions*      │      │ - Accounts       │                │
│  └──────────────────┘      │ - Event Logs     │                │
│                            └──────────────────┘                │
│                                                                  │
│  * Sessions still need volume mount for WhatsApp auth!          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## ⚠️ IMPORTANT: Sessions Still Need Volume!

WhatsApp sessions (auth credentials) are stored as FILES, not in database.
You still need to mount a volume for sessions:

```
Volumes Tab → + New Volume
Mount Path: /app/mini-services/whatsapp-service/sessions
Size: 1 GB
```

## Environment Variables

Railway will automatically provide:
- `DATABASE_URL` - PostgreSQL connection (from PostgreSQL service)
- `PORT` - App port

You need to add:
- `GROQ_API_KEY` - Your Groq API key for AI responses
- `NEXTAUTH_SECRET` - For NextAuth (if using)

## Local Development

### Option 1: Use Docker PostgreSQL

```bash
# Start local PostgreSQL
docker-compose up -d

# Run migrations
bun run db:migrate

# Start dev server
bun run dev
```

### Option 2: Use Railway PostgreSQL Remotely

1. Copy `DATABASE_URL` from Railway (PostgreSQL service → Variables)
2. Update `.env` with the Railway connection string
3. Run `bun run db:migrate`
4. Run `bun run dev`

## Troubleshooting

### "Can't reach database server"
- Check if PostgreSQL service is running in Railway
- Verify DATABASE_URL is correctly injected

### "Migration failed"
- Check Railway logs
- Ensure Prisma schema matches PostgreSQL requirements

### "Sessions lost after redeploy"
- Mount volume at `/app/mini-services/whatsapp-service/sessions`

## Database Schema

The app uses these tables:
- `WhatsAppAccount` - Connected accounts
- `Personality` - Persistent personalities (by phone number!)
- `ChatPair` - Chat pairings
- `Message` - Message history
- `EventLog` - System events
- `WarmingConfig` - Configuration
- `BulkQueue` - Bulk operations queue
