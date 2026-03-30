# Railway Deployment Guide - 2 Services Architecture

This guide explains how to deploy WhatsApp Warmer as **2 separate Railway services** for maximum stability.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Railway Cloud                           │
│                                                             │
│  ┌─────────────────────┐     ┌─────────────────────────┐   │
│  │   whatsapp-warmer   │     │   whatsapp-service      │   │
│  │   (Next.js)         │────▶│   (Baileys + Socket.io) │   │
│  │                     │     │                         │   │
│  │   Port: 3000        │     │   Port: 3030            │   │
│  │   Public: YES       │     │   Public: NO            │   │
│  └─────────────────────┘     └─────────────────────────┘   │
│           │                              │                  │
│           │      Private Network         │                  │
│           │  (whatsapp-service.railway.internal)           │
│           └──────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## Why 2 Services?

1. **Stability**: WebSocket upgrade fails behind Next.js API routes
2. **Scalability**: Each service can scale independently
3. **Reliability**: No more 502/504 errors from internal proxy
4. **Performance**: Direct Socket.io connection via private network

## Deployment Steps

### Step 1: Create Services in Railway

1. Open Railway Dashboard → Your Project
2. Create **Service 1** - `whatsapp-warmer`:
   - **Source**: GitHub repo
   - **Root Directory**: `/` (root - default)
   - **Builder**: Dockerfile
   - The Dockerfile at root will be used automatically

3. Create **Service 2** - `whatsapp-service`:
   - **Source**: Same GitHub repo
   - **Root Directory**: `whatsapp-service`
   - **Builder**: Dockerfile
   - The Dockerfile in `whatsapp-service/` folder will be used

### Step 2: Configure Environment Variables

#### whatsapp-warmer (Next.js Service):
| Variable | Value | Description |
|----------|-------|-------------|
| `WHATSAPP_SERVICE_HOST` | `whatsapp-service.railway.internal` | Railway internal DNS |
| `WHATSAPP_SERVICE_PORT` | `3030` | WhatsApp service port |
| `DATABASE_URL` | (from Railway database or file path) | Database connection |
| `GROQ_API_KEY` | (your API key) | AI integration |
| `PORT` | `3000` | Next.js port |

#### whatsapp-service:
| Variable | Value | Description |
|----------|-------|-------------|
| `PORT` | `3030` | Service port |
| `DATABASE_URL` | (same as above) | Database connection |
| `GROQ_API_KEY` | (your API key) | AI integration |
| `BAILEYS_LOG_LEVEL` | `info` | Logging level |

### Step 3: Networking Configuration

**whatsapp-warmer**:
- Public Networking: **ON**
- Generate a domain (e.g., `whatsapp-warmer.up.railway.app`)

**whatsapp-service**:
- Public Networking: **OFF** (important!)
- Only accessible via private network

### Step 4: Database Setup

Option A: Railway SQLite (simplest)
```
DATABASE_URL=file:/app/data/whatsapp.db
```

Option B: Railway PostgreSQL (recommended for production)
1. Add PostgreSQL service in Railway
2. Link the DATABASE_URL to both services

### Step 5: Deploy

1. Push code to GitHub
2. Railway will auto-deploy both services
3. Wait for both to show "Healthy" status
4. Open the whatsapp-warmer domain
5. Test by adding an account and scanning QR

## Troubleshooting

### Connection Issues

1. **Check logs** of both services
2. **Verify** `WHATSAPP_SERVICE_HOST` is correct
3. **Ensure** whatsapp-service is running (check port 3030)
4. **Test** internal connectivity from whatsapp-warmer shell

### Socket.io Not Connecting

1. Open Chrome DevTools → Network tab
2. Filter by `socket.io`
3. Check for 200 OK responses
4. Should see polling requests succeeding

### Database Errors

1. Both services must have the same `DATABASE_URL`
2. Run `prisma db push` on first deploy
3. Check database file permissions

## Local Development

For local development, the proxy automatically falls back to `localhost:3030`:

```env
# .env (local)
WHATSAPP_SERVICE_HOST=localhost
WHATSAPP_SERVICE_PORT=3030
```

Start both services:
```bash
# Terminal 1: WhatsApp service
cd whatsapp-service && bun dev

# Terminal 2: Next.js
bun dev
```

## File Structure

```
whatsapp-warmer/
├── Dockerfile                  # Next.js service
├── railway.json                # Railway config for Next.js
├── src/                        # Next.js app
├── prisma/                     # Database schema
├── package.json
│
└── whatsapp-service/           # Separate Railway service
    ├── Dockerfile              # WhatsApp service
    ├── index.ts                # Main service code
    ├── db.ts                   # Database client
    ├── prisma/                 # Prisma schema (same as root)
    └── package.json
```

## Notes

- Both services share the same database (DATABASE_URL)
- The whatsapp-service must be named exactly `whatsapp-service` in Railway for the internal DNS to work
- Private networking is free and doesn't count towards bandwidth
- Each service can be scaled independently if needed
