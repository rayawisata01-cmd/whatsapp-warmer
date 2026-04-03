import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Default path is /socket.io - no need to specify
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id} Transport: ${socket.conn.transport.name}`);
  
  socket.on('test', (data) => {
    console.log('Test event received:', data);
    socket.emit('test-response', { message: 'OK', data, time: new Date().toISOString() });
  });
  
  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id}, reason: ${reason}`);
  });
});

// Health endpoint  
httpServer.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', connections: io.sockets.sockets.size }));
  }
});

const PORT = 3030;
httpServer.listen(PORT, () => {
  console.log(`Socket.io Test Service on port ${PORT}`);
  console.log(`Default path: /socket.io`);
});
