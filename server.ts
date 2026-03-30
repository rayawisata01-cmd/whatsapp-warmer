/**
 * Custom Next.js Server with Socket.io WebSocket Proxy
 * 
 * This server handles Socket.io WebSocket connections properly by using
 * http-proxy-middleware instead of Next.js API routes.
 * 
 * Why custom server?
 * - Next.js API routes cannot handle WebSocket upgrade requests
 * - Socket.io requires WebSocket upgrade for reliable connections
 * - http-proxy-middleware provides proper WebSocket proxying
 */

import { createServer } from 'http';
import { parse } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import next from 'next';

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

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Create proxy middleware for Socket.io - SIMPLIFIED CONFIG
// Removed onProxyReq/onProxyRes handlers that were causing 404
const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  secure: false,
  
  // Path rewrite: /api/socket.io -> /socket.io
  pathRewrite: (path: string) => {
    return path.replace('/api/socket.io', '/socket.io');
  },
  
  // Log errors only
  onError: (err, req, res) => {
    console.error('[Proxy Error]', err.message);
  },
});

// Create HTTP server
const server = createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;

    // Handle Socket.io requests (both polling and WebSocket upgrade)
    if (pathname?.startsWith('/api/socket.io')) {
      (socketProxy as any)(req, res);
      return;
    }

    // Handle other requests with Next.js
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error('[Server Error]', req.url, err);
    res.statusCode = 500;
    res.end('internal server error');
  }
});

// Handle WebSocket upgrade for Socket.io
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = parse(req.url!, true);
  const { pathname } = parsedUrl;

  // Upgrade Socket.io WebSocket connections
  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[Server] WebSocket upgrade for Socket.io');
    (socketProxy as any).upgrade(req, socket, head);
    return;
  }

  // Destroy unknown upgrade requests
  socket.destroy();
});

// Start server
app.prepare().then(() => {
  server.listen(port, hostname, () => {
    console.log(`\n🚀 Server ready at http://${hostname}:${port}`);
    console.log(`📡 Socket.io proxy: /api/socket.io -> ${WHATSAPP_SERVICE_URL}/socket.io`);
    console.log('');
  });
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down...');
  server.close(() => process.exit(0));
});
