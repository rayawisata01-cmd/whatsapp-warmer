import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { db } from './db.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = 3030;

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await db.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: 'connected'
    });
  } catch (error) {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: 'error: ' + String(error)
    });
  }
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('init', { message: 'Connected to test server with DB' });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Test server with DB running on port ${PORT}`);
});

// Heartbeat
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Heartbeat - uptime: ${Math.floor(process.uptime())}s`);
}, 10000);

console.log('Process PID:', process.pid);
