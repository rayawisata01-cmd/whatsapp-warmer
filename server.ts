/**
 * Custom Next.js Server with Socket.io WebSocket Proxy
 * 
 * Uses Express + http-proxy-middleware for proper Socket.io proxying.
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createServer } from 'http';
import next from 'next';
import { parse } from 'url';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// WhatsApp service configuration
const WHATSAPP_SERVICE_HOST = process.env.WHATSAPP_SERVICE_HOST || 'localhost';
const WHATSAPP_SERVICE_PORT = process.env.WHATSAPP_SERVICE_PORT || '3030';
const WHATSAPP_SERVICE_URL = `http://${WHATSAPP_SERVICE_HOST}:${WHATSAPP_SERVICE_PORT}`;

console.log('='.repeat(60));
console.log('WhatsApp Warmer - Custom Server');
console.log('='.repeat(60));
console.log(`Environment: ${dev ? 'development' : 'production'}`);
console.log(`Port: ${port}`);
console.log(`WhatsApp Service URL: ${WHATSAPP_SERVICE_URL}`);
console.log('='.repeat(60));

// Create Express app
const expressApp = express();

// Create Next.js app
const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();

// ========================================
// SOCKET.IO PROXY CONFIGURATION
// ========================================

const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  secure: false,
  logger: console, // Enable logging for debugging
  
  // Rewrite path: /api/socket.io/* → /socket.io/*
  pathRewrite: (path: string) => {
    const newPath = path.replace('/api/socket.io', '/socket.io');
    console.log(`[Proxy] Path rewrite: ${path} -> ${newPath}`);
    return newPath;
  },
  
  on: {
    error: (err: Error) => {
      console.error('[Proxy Error]', err.message);
    },
    proxyReq: (proxyReq: any, req: any) => {
      console.log(`[Proxy] -> ${req.method} ${req.url}`);
    },
  },
});

// ========================================
// MOUNT SOCKET.IO PROXY FIRST
// ========================================
// This must come BEFORE the Next.js handler!
// Using a more specific path match

expressApp.use('/api/socket.io', (req, res, next) => {
  console.log(`[Express] Socket.io request: ${req.method} ${req.url}`);
  return socketProxy(req, res, next);
});

// ========================================
// NEXT.JS ROUTES (FALLBACK)
// ========================================

expressApp.use(async (req: any, res: any) => {
  try {
    const parsedUrl = parse(req.url!, true);
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error('[Next.js Error]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }
});

// ========================================
// CREATE HTTP SERVER
// ========================================

const server = createServer(expressApp);

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url!, true);
  
  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[Server] WebSocket upgrade for Socket.io:', pathname);
    (socketProxy as any).upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// ========================================
// START SERVER
// ========================================

nextApp.prepare().then(() => {
  server.listen(port, hostname, () => {
    console.log(`\n🚀 Server ready at http://${hostname}:${port}`);
    console.log(`📡 Socket.io proxy: /api/socket.io → ${WHATSAPP_SERVICE_URL}/socket.io`);
    console.log(`✅ WebSocket support: ENABLED`);
    console.log('');
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down...');
  server.close(() => process.exit(0));
});
