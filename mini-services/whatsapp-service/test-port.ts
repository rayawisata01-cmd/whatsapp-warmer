import express from 'express';
import { createServer } from 'http';

const app = express();
const server = createServer(app);

const PORT = 4040;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, uptime: process.uptime() });
});

server.listen(PORT, () => {
  console.log(`Test server on port ${PORT}`);
});

setInterval(() => console.log('alive'), 5000);
