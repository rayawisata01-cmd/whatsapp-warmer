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
 * 
 * FIXED: Proper WebSocket upgrade handling to prevent:
 * - HTTP 308 redirects
 * - "Refused to set unsafe header 'Connection'" warnings
 * - WebSocket upgrade failures
 */

import { createServer } from 'http';
import { parse } from 'url';
import { createProxyMiddleware, RequestHandler } from 'http-proxy-middleware';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// WhatsApp service configuration
const WHATSAPP_SERVICE_HOST = process.env.WHATSAPP_SERVICE_HOST || 'localhost';
const WHATSAPP_SERVICE_PORT = process.env.WHATSAPP_SERVICE_PORT || '3030';
const WHATSAPP_SERVICE_URL = `http://${WHATSAPP_SERVICE_HOST}:${WHATSAPP_SERVICE_PORT}`;

console.log('='.repeat(60));
console.log('WhatsApp Warmer - Custom Server (WebSocket Fixed)');
console.log('='.repeat(60));
console.log(`Environment: ${dev ? 'development' : 'production'}`);
console.log(`Port: ${port}`);
console.log(`WhatsApp Service URL: ${WHATSAPP_SERVICE_URL}`);
console.log('='.repeat(60));

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Create proxy middleware for Socket.io with proper WebSocket handling
const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  secure: false,
  xfwd: true, // Forward X-Forwarded headers
  preserveHeaderKeyCase: true, // Preserve header case
  
  // Path rewrite: /api/socket.io -> /socket.io
  pathRewrite: (path: string) => {
    const newPath = path.replace('/api/socket.io', '/socket.io');
    console.log(`[Proxy] Rewriting path: ${path} -> ${newPath}`);
    return newPath;
  },
  
  // FIXED: Handle WebSocket upgrade headers properly
  onProxyReq: (proxyReq, req, res) => {
    // For WebSocket upgrade requests, ensure proper headers
    if (req.headers.upgrade) {
      console.log('[Proxy] WebSocket upgrade request detected');
      proxyReq.setHeader('Upgrade', req.headers.upgrade);
      proxyReq.setHeader('Connection', req.headers.connection || 'Upgrade');
    }
    
    // Add forwarded headers for proper protocol detection
    const proto = (req as any).protocol || 'http';
    proxyReq.setHeader('X-Forwarded-Proto', proto);
    proxyReq.setHeader('X-Forwarded-Host', req.headers.host || '');
  },
  
  // FIXED: Handle response headers for WebSocket upgrade
  onProxyRes: (proxyRes, req, res) => {
    // For WebSocket upgrade responses, forward the headers
    if (proxyRes.headers.upgrade) {
      console.log('[Proxy] WebSocket upgrade response received');
      res.setHeader('Upgrade', proxyRes.headers.upgrade);
      res.setHeader('Connection', proxyRes.headers.connection || 'Upgrade');
    }
    
    // Ensure no caching for Socket.io
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
  
  // Handle proxy errors gracefully
  onError: (err, req, res) => {
    console.error('[Proxy] Error:', err.message);
    
    if (!res.headersSent) {
      // Check if it's a socket.io request
      const isSocketIo = req.url?.includes('socket.io');
      
      if (isSocketIo) {
        // Return Socket.io compatible error
        (res as any).status(503).end('4{"message":"Service unavailable","code":503}');
      } else {
        (res as any).status(500).end('Proxy error');
      }
    }
  },
});

// Create HTTP server
const server = createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;

    // Handle Socket.io polling requests
    if (pathname?.startsWith('/api/socket.io')) {
      (socketProxy as RequestHandler)(req, res, (err: any) => {
        if (err) {
          console.error('[Server] Proxy error:', err);
          res.statusCode = 500;
          res.end('Proxy error');
        }
      });
      return;
    }

    // Handle other requests with Next.js
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error('[Server] Error occurred handling', req.url, err);
    res.statusCode = 500;
    res.end('internal server error');
  }
});

// Handle WebSocket upgrade for Socket.io
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = parse(req.url!, true);
  const { pathname } = parsedUrl;

  console.log('[Server] WebSocket upgrade request:', pathname);

  // Upgrade Socket.io WebSocket connections
  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[Server] Upgrading WebSocket for Socket.io');
    
    // Use the proxy's upgrade method
    (socketProxy as any).upgrade(req, socket, head);
    return;
  }

  // Let Next.js handle other WebSocket upgrades (if any)
  // For now, destroy unknown upgrade requests
  socket.destroy();
});

// Start server
app.prepare().then(() => {
  server.listen(port, hostname, () => {
    console.log(`\n🚀 Server ready at http://${hostname}:${port}`);
    console.log(`📡 Socket.io proxy: /api/socket.io -> ${WHATSAPP_SERVICE_URL}/socket.io`);
    console.log(`✅ WebSocket upgrade: ENABLED`);
    console.log('');
  });
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
