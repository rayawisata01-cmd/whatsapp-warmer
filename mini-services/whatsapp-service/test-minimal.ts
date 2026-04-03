import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = 3030;

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('init', { message: 'Connected to test server' });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

// Heartbeat
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Heartbeat - uptime: ${Math.floor(process.uptime())}s`);
}, 10000);

console.log('Process PID:', process.pid);
console.log('Node version:', process.version);

// Handle signals
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received');
  httpServer.close(() => process.exit(0));
});

process.on('beforeExit', (code) => {
  console.log('beforeExit with code:', code);
});

process.on('exit', (code) => {
  console.log('exit with code:', code);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
