/**
 * Custom Next.js Server with Socket.io WebSocket Proxy
 * 
 * Simpler approach: Handle Socket.io directly in the HTTP server
 * without relying on Express middleware path matching.
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

// Create proxy for Socket.io
const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  secure: false,
  pathRewrite: (path: string) => path.replace('/api/socket.io', '/socket.io'),
  on: {
    error: (err: Error) => console.error('[Proxy Error]', err.message),
    proxyReq: (proxyReq: any, req: any) => {
      console.log(`[Proxy] ${req.method} ${req.url} -> ${WHATSAPP_SERVICE_URL}`);
    },
  },
});

// Create HTTP server
const server = createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;

    // Handle Socket.io requests (both polling and initial handshake)
    if (pathname?.startsWith('/api/socket.io')) {
      console.log(`[Server] Socket.io request: ${req.method} ${pathname}`);
      (socketProxy as any)(req, res);
      return;
    }

    // Handle all other requests with Next.js
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error('[Server Error]', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = parse(req.url!, true);
  const { pathname } = parsedUrl;

  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[Server] WebSocket upgrade for Socket.io:', pathname);
    (socketProxy as any).upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Start server
app.prepare().then(() => {
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
