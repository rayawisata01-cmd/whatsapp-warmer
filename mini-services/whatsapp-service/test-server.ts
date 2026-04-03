import express from 'express';
const app = express();
const PORT = 3030;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});

// Keep process alive
setInterval(() => {}, 30000);
