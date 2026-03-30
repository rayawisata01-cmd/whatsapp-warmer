# Railway Deployment Guide - WhatsApp Warmer

## Prerequisites

1. **GitHub Repository** - Push code ke GitHub
2. **Railway Account** - Daftar di [railway.app](https://railway.app)
3. **Groq API Key** - Dapatkan gratis di [console.groq.com/keys](https://console.groq.com/keys)

## Deployment Steps

### 1. Push ke GitHub

```bash
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### 2. Buat Project di Railway

1. Buka [railway.app](https://railway.app)
2. Klik **"New Project"**
3. Pilih **"Deploy from GitHub repo"**
4. Pilih repository WhatsApp Warmer
5. Railway akan otomatis detect Dockerfile

### 3. Set Environment Variables

Di Railway dashboard, buka **Variables** tab dan tambahkan:

| Variable | Value | Description |
|----------|-------|-------------|
| `GROQ_API_KEY` | `gsk_xxxxx` | API key dari Groq (wajib untuk AI) |
| `PORT` | `3000` | Port untuk Next.js (otomatis) |

> **Note:** `DATABASE_URL` sudah diset di Dockerfile untuk SQLite

### 4. Set Port Configuration

Di Railway dashboard:
1. Buka **Settings** tab
2. Cari **Networking** section
3. Pastikan port yang di-expose: `3000`

### 5. Deploy

Klik **"Deploy"** dan tunggu build selesai (±3-5 menit)

## Verifikasi Deployment

### 1. Health Check

```bash
curl https://your-app.railway.app/api/wa/health
```

Response harus:
```json
{"status":"ok","accounts":0}
```

### 2. Test Socket.io

Buka browser ke `https://your-app.railway.app`
- Status harus menunjukkan "Connected"
- Badge hijau di kanan atas

### 3. Test QR Code

1. Klik tombol **"+"** untuk tambah akun
2. Masukkan Account ID (contoh: `akun-1`)
3. Pilih metode QR Code
4. Klik **Start Session**
5. QR Code harus muncul dalam beberapa detik

## Troubleshooting

### QR Code Tidak Muncul

1. **Check Logs** di Railway dashboard
2. Pastikan `GROQ_API_KEY` sudah diset dengan benar
3. Cek apakah WhatsApp service berjalan:
   ```bash
   curl https://your-app.railway.app/api/wa/accounts
   ```

### Socket.io Connection Failed

1. Pastikan menggunakan transport `polling` (bukan WebSocket)
2. Check browser console untuk error
3. Pastikan path `/api/socket.io` benar

### Build Failed

1. Check build logs di Railway
2. Pastikan `bun.lock` ada di repository
3. Jika error Prisma, pastikan schema valid

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway Container                     │
│                                                         │
│  ┌─────────────────┐      ┌─────────────────────────┐  │
│  │   Next.js App   │      │   WhatsApp Service      │  │
│  │   Port: 3000    │──────│   Port: 3030            │  │
│  │                 │      │                         │  │
│  │  - API Routes   │      │  - Socket.io Server     │  │
│  │  - Frontend     │      │  - Baileys WhatsApp     │  │
│  │  - Socket Proxy │      │  - Groq AI Integration  │  │
│  └─────────────────┘      └─────────────────────────┘  │
│           │                          │                  │
│           └──────────┬───────────────┘                  │
│                      │                                  │
│              ┌───────▼───────┐                          │
│              │  SQLite DB    │                          │
│              │  /app/data/   │                          │
│              └───────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | **Yes** | - | API key untuk AI responses |
| `DATABASE_URL` | No | `file:/app/data/whatsapp.db` | SQLite database path |
| `PORT` | No | `3000` | Next.js server port |
| `NODE_ENV` | No | `production` | Environment mode |

## Support

Jika mengalami masalah:
1. Check Railway logs
2. Check browser console
3. Test API endpoints dengan curl
4. Pastikan environment variables sudah benar
