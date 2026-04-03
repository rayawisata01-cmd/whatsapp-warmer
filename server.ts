/**
 * Custom Next.js Server with Socket.io Proxy
 * 
 * ========================================
 * SOLUSI SIMPLIFIED - DIRECT PROXY
 * ========================================
 * 
 * MASALAH:
 * - Raw TCP tunnel korup data
 * - Multiple layers menambah latency
 * 
 * SOLUSI:
 * - Single HTTP server
 * - Socket.io requests diproxy dengan http-proxy
 * - WebSocket upgrade ditangani dengan benar
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { request as httpRequest } from 'http';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const WA_HOST = process.env.WHATSAPP_SERVICE_HOST || 'localhost';
const WA_PORT = parseInt(process.env.WHATSAPP_SERVICE_PORT || '3030', 10);

console.log('='.repeat(60));
console.log('WhatsApp Warmer - Custom Server');
console.log(`Port: ${port} | WA Service: ${WA_HOST}:${WA_PORT}`);
console.log('='.repeat(60));

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ==================== SOCKET.IO PATH CHECK ====================
function isSocketIOPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname.startsWith('/socket.io') || pathname.startsWith('/api/socket.io');
}

// ==================== HTTP PROXY FOR POLLING ====================
function proxyHttpRequest(req: IncomingMessage, res: ServerResponse, targetPath: string) {
  console.log(`[Proxy HTTP] ${req.method} ${targetPath}`);
  
  const options = {
    hostname: WA_HOST,
    port: WA_PORT,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${WA_HOST}:${WA_PORT}`,
      'x-forwarded-for': req.socket.remoteAddress || '',
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': 'https',
    },
  };
  
  const proxyReq = httpRequest(options, (proxyRes) => {
    console.log(`[Proxy HTTP] Response: ${proxyRes.statusCode}`);
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (err) => {
    console.error(`[Proxy HTTP] Error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy Error: ' + err.message);
    }
  });
  
  // Set timeout
  proxyReq.setTimeout(60000, () => {
    console.error('[Proxy HTTP] Timeout');
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Gateway Timeout');
    }
  });
  
  req.pipe(proxyReq);
}

// ==================== CREATE SERVER ====================
const server = createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url!, true);
    const { pathname } = parsedUrl;
    
    // ========== SOCKET.IO POLLING ==========
    if (isSocketIOPath(pathname)) {
      // Normalize path
      let targetPath = pathname!;
      if (targetPath.startsWith('/api/')) {
        targetPath = targetPath.replace('/api', '');
      }
      targetPath += parsedUrl.search || '';
      
      proxyHttpRequest(req, res, targetPath);
      return;
    }
    
    // ========== ALL OTHER REQUESTS ==========
    await handle(req, res, parsedUrl);
    
  } catch (error: any) {
    console.error(`[Server Error] ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error: ' + error.message);
    }
  }
});

// ==================== WEBSOCKET UPGRADE ====================
// Use http-proxy-middleware's upgrade method for proper WebSocket handling
import { createProxyMiddleware } from 'http-proxy-middleware';

const WA_SERVICE_URL = `http://${WA_HOST}:${WA_PORT}`;

// Create Socket.io proxy middleware
const socketIoProxy = createProxyMiddleware({
  target: WA_SERVICE_URL,
  changeOrigin: true,
  ws: true,                      // Enable WebSocket
  secure: false,
  xfwd: true,
  logger: console,
  
  onProxyReqWs: (proxyReq, req, socket, options, head) => {
    console.log(`[Proxy WS] Upgrade: ${req.url}`);
    
    // Ensure proper WebSocket headers
    if (!proxyReq.getHeader('Upgrade')) {
      proxyReq.setHeader('Upgrade', 'websocket');
    }
    if (!proxyReq.getHeader('Connection') || proxyReq.getHeader('Connection') !== 'Upgrade') {
      proxyReq.setHeader('Connection', 'Upgrade');
    }
  },
  
  onError: (err, req, res) => {
    console.error(`[Proxy Error] ${err.message}`);
  },
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url!, true);
  
  if (isSocketIOPath(pathname)) {
    console.log(`[WS Upgrade] ${pathname}`);
    
    // Normalize path
    let normalizedUrl = req.url!;
    if (pathname.startsWith('/api/')) {
      normalizedUrl = normalizedUrl.replace('/api', '');
      console.log(`[WS Upgrade] Normalized: ${normalizedUrl}`);
    }
    req.url = normalizedUrl;
    
    // Use proxy middleware's upgrade handler
    (socketIoProxy as any).upgrade(req, socket, head);
  } else {
    // Not a Socket.io WebSocket - destroy
    socket.destroy();
  }
});

// ==================== START SERVER ====================
app.prepare().then(() => {
  server.listen(port, hostname, () => {
    console.log(`\n🚀 Ready on http://${hostname}:${port}`);
    console.log(`📡 Socket.io Proxy:`);
    console.log(`   /socket.io      → ${WA_SERVICE_URL}/socket.io`);
    console.log(`   /api/socket.io  → ${WA_SERVICE_URL}/socket.io (legacy)`);
    console.log(``);
    console.log(`✅ Using http-proxy-middleware v3 with WebSocket support`);
    console.log(``);
  });
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
