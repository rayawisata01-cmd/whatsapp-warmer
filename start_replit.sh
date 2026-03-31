#!/bin/bash
# Simple startup for Replit

echo "🚀 Starting WhatsApp Warmer..."

# Create directories
mkdir -p data sessions backups logs

# Set environment
export DATABASE_URL="file:$PWD/data/whatsapp.db"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Install WhatsApp service dependencies
if [ ! -d "mini-services/whatsapp-service/node_modules" ]; then
    echo "📦 Installing WhatsApp service dependencies..."
    cd mini-services/whatsapp-service && npm install && cd ../..
fi

# Setup database
echo "🗄️ Setting up database..."
npx prisma generate
npx prisma db push --skip-generate

# Build Next.js if needed
if [ ! -d ".next" ]; then
    echo "🔨 Building Next.js..."
    npm run build
fi

# Start services
echo "🚀 Starting services..."

# Start WhatsApp service in background
cd mini-services/whatsapp-service
node index.js > ../../logs/whatsapp.log 2>&1 &
cd ../..

# Wait for WhatsApp service
sleep 3

# Start Next.js
echo "Starting Next.js on port 3000..."
npm run start > logs/nextjs.log 2>&1 &

echo ""
echo "✅ Services started!"
echo "📊 Open the webview to see the app"
echo ""

# Keep running - show WhatsApp logs
tail -f logs/whatsapp.log logs/nextjs.log 2>/dev/null || sleep infinity
