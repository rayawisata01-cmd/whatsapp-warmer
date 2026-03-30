/**
 * Custom Next.js Server with Socket.io WebSocket Proxy
 * 
 * ARCHITECTURE:
 * Browser → Railway Edge Proxy → This Server (port 3000) → WhatsApp Service (port 3030)
 * 
 * This server uses Express + http-proxy-middleware for proper Socket.io proxying.
 * 
 * FIXES:
 * - "Refused to set unsafe header 'Connection'" - removed client-side header
 * - WebSocket upgrade handling - proper ws: true in proxy config
 * - 404 errors - fixed path matching with Express middleware
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
// This proxy forwards requests from /api/socket.io to the WhatsApp service
// It handles BOTH polling (HTTP) and WebSocket upgrade requests

const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true, // CRITICAL: Enable WebSocket proxying
  secure: false,
  
  // Rewrite path: /api/socket.io/* → /socket.io/*
  pathRewrite: {
    '^/api/socket.io': '/socket.io',
  },
  
  // Log for debugging
  on: {
    error: (err: Error, req: any, res: any) => {
      console.error('[Proxy Error]', err.message);
    },
    proxyReq: (proxyReq: any, req: any, res: any) => {
      // Don't log every request in production (too noisy)
      if (dev) {
        console.log('[Proxy] →', req.method, req.url);
      }
    },
    open: (proxySocket: any) => {
      console.log('[Proxy] WebSocket connection opened');
    },
    close: (proxySocket: any) => {
      console.log('[Proxy] WebSocket connection closed');
    },
  },
});

// Mount Socket.io proxy at /api/socket.io
// This handles both polling requests AND is the base for WebSocket upgrades
expressApp.use('/api/socket.io', socketProxy);

// ========================================
// NEXT.JS ROUTES
// ========================================
// All other requests go to Next.js

expressApp.all('*', async (req: any, res: any) => {
  try {
    const parsedUrl = parse(req.url!, true);
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error('[Next.js Error]', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

// ========================================
// CREATE HTTP SERVER
// ========================================

const server = createServer(expressApp);

// Handle WebSocket upgrade requests
// The proxy middleware will handle upgrades for /api/socket.io paths
server.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url!, true);
  
  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[Server] WebSocket upgrade request for Socket.io');
    // The express-proxy-middleware handles this automatically when ws: true
    // But we need to manually invoke it for native Node HTTP server
    (socketProxy as any).upgrade(req, socket, head);
  } else {
    // Destroy unknown upgrade requests
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
