import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = 3030;

// Minimal state
const accounts = new Map();
const logs: any[] = [];

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    accounts: accounts.size
  });
});

// Accounts endpoint
app.get('/accounts', (req, res) => {
  res.json([]);
});

// Logs endpoint  
app.get('/logs', (req, res) => {
  res.json(logs.slice(-50));
});

// Socket.io events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('init', { accounts: [], logs: [], chatPairs: [] });
  
  socket.on('start-session', async (data: any) => {
    console.log('Start session request:', data);
    socket.emit('log', { type: 'info', message: 'Session start requested (minimal mode)' });
  });
});

// Heartbeat
setInterval(() => {
  console.log(`[HEARTBEAT] uptime: ${Math.floor(process.uptime())}s, accounts: ${accounts.size}`);
}, 30000);

// Start
httpServer.listen(PORT, () => {
  console.log(`Minimal WhatsApp service running on port ${PORT}`);
});

console.log('Started minimal service with PID:', process.pid);
