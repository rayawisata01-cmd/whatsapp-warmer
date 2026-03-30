/**
 * Custom Next.js Server with Socket.io WebSocket Proxy
 * 
 * IMPORTANT: Next.js API routes CANNOT handle WebSocket upgrades.
 * This custom server is REQUIRED for WebSocket support.
 */

import { createServer } from 'http';
import { parse } from 'url';
import { createProxyMiddleware, RequestHandler } from 'http-proxy-middleware';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const WHATSAPP_SERVICE_URL = `http://${process.env.WHATSAPP_SERVICE_HOST || 'localhost'}:${process.env.WHATSAPP_SERVICE_PORT || '3030'}`;

console.log('='.repeat(60));
console.log('WhatsApp Warmer - Custom Server');
console.log(`Port: ${port} | WA Service: ${WHATSAPP_SERVICE_URL}`);
console.log('='.repeat(60));

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Create proxy with proper error handling
const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true, // WebSocket support
  secure: false,
  
  // Rewrite path
  pathRewrite: (path: string) => {
    const newPath = path.replace('/api/socket.io', '/socket.io');
    console.log(`[Path Rewrite] ${path} → ${newPath}`);
    return newPath;
  },
  
  // Handle errors
  onError: (err, req, res) => {
    console.error('[Proxy Error]', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy Error: ' + err.message);
    }
  },
  
  // Log proxy requests
  onProxyReq: (proxyReq, req) => {
    console.log(`[Proxy Request] ${req.method} ${(req as any).url}`);
  },
  
  // Log proxy responses
  onProxyRes: (proxyRes, req) => {
    console.log(`[Proxy Response] ${(req as any).url} → ${proxyRes.statusCode}`);
  },
});

const server = createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;

    // Handle Socket.io requests - MUST come before Next.js handler
    if (pathname?.startsWith('/api/socket.io')) {
      console.log(`[Incoming] Socket.io request: ${req.method} ${pathname}`);
      
      // Call proxy with proper callback pattern
      (socketProxy as RequestHandler)(req, res, (err) => {
        if (err) {
          console.error('[Proxy Callback Error]', err.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Proxy Error');
          }
        }
      });
      return;
    }

    // All other requests go to Next.js
    await handle(req, res, parsedUrl);
  } catch (error) {
    console.error('[Server Error]', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url!, true);
  
  if (pathname?.startsWith('/api/socket.io')) {
    console.log(`[WS Upgrade] ${pathname}`);
    (socketProxy as any).upgrade(req, socket, head);
  } else {
    // Destroy other WebSocket upgrade requests
    socket.destroy();
  }
});

// Start server
app.prepare().then(() => {
  server.listen(port, hostname, () => {
    console.log(`\n🚀 Server ready at http://${hostname}:${port}`);
    console.log(`📡 Socket.io proxy: /api/socket.io → ${WHATSAPP_SERVICE_URL}/socket.io`);
    console.log(`✅ WebSocket support: ENABLED\n`);
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
