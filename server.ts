/**
 * Custom Next.js Server with Socket.io WebSocket Proxy
 * 
 * This is REQUIRED for WebSocket support - Next.js API routes cannot handle WebSocket upgrades.
 */

import { createServer } from 'http';
import { parse } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
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

const socketProxy = createProxyMiddleware({
  target: WHATSAPP_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  pathRewrite: (path: string) => path.replace('/api/socket.io', '/socket.io'),
});

const server = createServer(async (req, res) => {
  const { pathname } = parse(req.url!, true);
  
  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[Proxy]', req.method, pathname);
    (socketProxy as any)(req, res);
    return;
  }
  
  await handle(req, res, parse(req.url!, true));
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url!, true);
  if (pathname?.startsWith('/api/socket.io')) {
    console.log('[WS Upgrade]', pathname);
    (socketProxy as any).upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

app.prepare().then(() => {
  server.listen(port, hostname, () => {
    console.log(`🚀 Server ready | Socket.io proxy: /api/socket.io → ${WHATSAPP_SERVICE_URL}/socket.io`);
  });
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
