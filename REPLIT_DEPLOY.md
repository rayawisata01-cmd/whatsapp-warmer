# WhatsApp Multi-Account Warmer - Replit Deployment

## 🚀 Quick Deploy to Replit

### Step 1: Import from GitHub
1. Go to [replit.com](https://replit.com) and login/signup (No credit card needed!)
2. Click **"Create Repl"**
3. Select **"Import from GitHub"**
4. Paste the repository URL:
   ```
   https://github.com/rayawisata01-cmd/whatsapp-warmer
   ```
5. Click **"Import from GitHub"**

### Step 2: Configure Environment
1. Go to **"Secrets"** tab (lock icon in sidebar)
2. Add these secrets:

| Key | Value | Required |
|-----|-------|----------|
| `GROQ_API_KEY` | Your Groq API key | ✅ Yes |
| `DATABASE_URL` | `file:/home/runner/$REPL_SLUG/data/whatsapp.db` | Auto |

### Step 3: Run!
1. Click the **"Run"** button (green play button)
2. Wait for services to start (about 30-60 seconds)
3. Your app will be available at: `https://<your-repl-name>.<your-username>.repl.co`

### Step 4: Keep-Alive (Important!)
Replit free tier sleeps after inactivity. To keep it running:

1. Go to [uptimerobot.com](https://uptimerobot.com) and signup (free)
2. Add a new monitor:
   - Monitor Type: HTTP(s)
   - URL: `https://<your-repl-name>.<your-username>.repl.co`
   - Monitoring Interval: 5 minutes
3. This will ping your repl every 5 minutes and keep it awake

## 📊 Resource Limits (Replit Free Tier)

| Resource | Limit |
|----------|-------|
| RAM | 500MB - 1GB |
| CPU | Shared |
| Storage | 500MB |
| Network | Limited |

## ⚠️ Important Notes

### Sessions Will Persist
- Session files are stored in `/home/runner/$REPL_SLUG/sessions`
- If your repl gets deleted, sessions are lost

### Performance
- Replit free tier is limited
- WhatsApp connections may be slower
- QR generation might take longer

### Best Practices
1. **Limit active accounts** to 2-3 maximum
2. **Use keep-alive** (UptimeRobot) to prevent sleep
3. **Monitor logs** for any errors

## 🔧 Troubleshooting

### WhatsApp Service Not Starting
```bash
# Check WhatsApp service logs
tail -f ~/logs/whatsapp.log
```

### Next.js Not Starting
```bash
# Check Next.js logs
tail -f ~/logs/nextjs.log
```

### Database Errors
```bash
# Reinitialize database
cd ~/data
rm whatsapp.db
cd ..
bunx prisma db push
```

### Port Already in Use
```bash
# Find and kill process on port
lsof -i :3000
lsof -i :3030
```

## 🔄 Updates

To update from GitHub:
1. Go to **"Version Control"** tab in sidebar
2. Click **"Pull"** to get latest changes
3. Click **"Run"** to restart

## 💡 Tips

1. **Always use QR code instead of pairing code** - More reliable on Replit
2. **Clear old sessions** if having connection issues
3. **Keep accounts minimal** - Resource is limited
4. **Check logs regularly** - Monitor for errors
