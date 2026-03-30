import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { writeFile, readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  path: '/socket.io'
});

const PORT = 3050;

// ==================== TYPES ====================

interface VPSConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  apiKey?: string;
  status: 'online' | 'offline' | 'connecting';
  lastSeen?: Date;
  maxAccounts: number;
  region?: string;
}

interface VPSStats {
  id: string;
  online: number;
  offline: number;
  connecting: number;
  warming: number;
  totalMessages: number;
  healthScore: number;
}

interface VPSState {
  config: VPSConfig;
  stats: VPSStats;
  accounts: any[];
  lastUpdate: Date;
}

// ==================== STATE ====================

const vpsInstances: Map<string, VPSState> = new Map();
const eventLogs: Array<{
  id: string;
  type: 'vps' | 'account' | 'error' | 'info';
  vpsId?: string;
  message: string;
  timestamp: Date;
}> = [];

const MAX_LOGS = 500;
const CONFIG_FILE = join(__dirname, 'vps-config.json');

// Default VPS configurations (for demo, can be added dynamically)
let defaultVPSConfigs: VPSConfig[] = [
  {
    id: 'vps-1',
    name: 'VPS Jakarta 1',
    host: 'localhost',
    port: 3031,
    status: 'offline',
    maxAccounts: 20,
    region: 'Jakarta'
  },
  {
    id: 'vps-2',
    name: 'VPS Jakarta 2',
    host: 'localhost',
    port: 3032,
    status: 'offline',
    maxAccounts: 20,
    region: 'Jakarta'
  },
  {
    id: 'vps-3',
    name: 'VPS Singapore 1',
    host: 'localhost',
    port: 3033,
    status: 'offline',
    maxAccounts: 20,
    region: 'Singapore'
  },
  {
    id: 'vps-4',
    name: 'VPS Singapore 2',
    host: 'localhost',
    port: 3034,
    status: 'offline',
    maxAccounts: 20,
    region: 'Singapore'
  },
  {
    id: 'vps-5',
    name: 'VPS Bandung',
    host: 'localhost',
    port: 3035,
    status: 'offline',
    maxAccounts: 20,
    region: 'Bandung'
  }
];

// ==================== UTILITY FUNCTIONS ====================

function addLog(type: typeof eventLogs[0]['type'], message: string, vpsId?: string) {
  const log = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    vpsId,
    message,
    timestamp: new Date()
  };
  eventLogs.unshift(log);
  if (eventLogs.length > MAX_LOGS) {
    eventLogs.pop();
  }
  io.emit('log', log);
}

async function saveConfig() {
  try {
    const configs = Array.from(vpsInstances.values()).map(v => v.config);
    await writeFile(CONFIG_FILE, JSON.stringify(configs, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

async function loadConfig() {
  try {
    await access(CONFIG_FILE);
    const data = await readFile(CONFIG_FILE, 'utf-8');
    const configs = JSON.parse(data);
    configs.forEach((config: VPSConfig) => {
      vpsInstances.set(config.id, {
        config,
        stats: {
          id: config.id,
          online: 0,
          offline: 0,
          connecting: 0,
          warming: 0,
          totalMessages: 0,
          healthScore: 0
        },
        accounts: [],
        lastUpdate: new Date()
      });
    });
  } catch {
    // Initialize with default configs
    defaultVPSConfigs.forEach(config => {
      vpsInstances.set(config.id, {
        config,
        stats: {
          id: config.id,
          online: 0,
          offline: 0,
          connecting: 0,
          warming: 0,
          totalMessages: 0,
          healthScore: 0
        },
        accounts: [],
        lastUpdate: new Date()
      });
    });
  }
}

// ==================== VPS COMMUNICATION ====================

async function fetchVPSStatus(vps: VPSConfig): Promise<{ stats: VPSStats; accounts: any[] } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`http://${vps.host}:${vps.port}/stats`, {
      signal: controller.signal,
      headers: vps.apiKey ? { 'Authorization': `Bearer ${vps.apiKey}` } : {}
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const stats = await response.json();

    // Fetch accounts
    const accountsResponse = await fetch(`http://${vps.host}:${vps.port}/accounts/light`, {
      signal: controller.signal,
      headers: vps.apiKey ? { 'Authorization': `Bearer ${vps.apiKey}` } : {}
    });

    const accounts = accountsResponse.ok ? await accountsResponse.json() : [];

    return { stats: { ...stats, id: vps.id }, accounts };
  } catch (error) {
    return null;
  }
}

async function updateAllVPSStatus() {
  for (const [id, state] of vpsInstances) {
    const result = await fetchVPSStatus(state.config);
    
    if (result) {
      state.config.status = 'online';
      state.config.lastSeen = new Date();
      state.stats = result.stats;
      state.accounts = result.accounts.map((acc: any) => ({
        ...acc,
        vpsId: id,
        vpsName: state.config.name
      }));
      state.lastUpdate = new Date();
    } else {
      state.config.status = 'offline';
      state.stats = {
        id,
        online: 0,
        offline: 0,
        connecting: 0,
        warming: 0,
        totalMessages: 0,
        healthScore: 0
      };
      state.accounts = [];
    }
  }

  io.emit('vps-status', getAllVPSStatus());
}

function getAllVPSStatus() {
  return Array.from(vpsInstances.values()).map(v => ({
    config: v.config,
    stats: v.stats,
    accountCount: v.accounts.length,
    lastUpdate: v.lastUpdate
  }));
}

function getAllAccounts() {
  const accounts: any[] = [];
  for (const state of vpsInstances.values()) {
    accounts.push(...state.accounts);
  }
  return accounts;
}

function getAggregatedStats() {
  const allStats = Array.from(vpsInstances.values()).map(v => v.stats);
  
  return {
    totalVPS: vpsInstances.size,
    onlineVPS: Array.from(vpsInstances.values()).filter(v => v.config.status === 'online').length,
    totalAccounts: allStats.reduce((sum, s) => sum + s.online + s.offline + s.connecting, 0),
    onlineAccounts: allStats.reduce((sum, s) => sum + s.online, 0),
    offlineAccounts: allStats.reduce((sum, s) => sum + s.offline, 0),
    warmingAccounts: allStats.reduce((sum, s) => sum + s.warming, 0),
    totalMessages: allStats.reduce((sum, s) => sum + s.totalMessages, 0),
    avgHealthScore: Math.round(
      allStats.reduce((sum, s) => sum + s.healthScore, 0) / (allStats.length || 1)
    )
  };
}

// ==================== VPS ACTIONS ====================

async function sendCommandToVPS(vpsId: string, endpoint: string, method: string = 'POST', body?: any) {
  const state = vpsInstances.get(vpsId);
  if (!state) {
    throw new Error(`VPS ${vpsId} not found`);
  }

  if (state.config.status !== 'online') {
    throw new Error(`VPS ${vpsId} is offline`);
  }

  try {
    const response = await fetch(`http://${state.config.host}:${state.config.port}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.config.apiKey ? { 'Authorization': `Bearer ${state.config.apiKey}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    addLog('error', `Command failed to ${vpsId}: ${error.message}`, vpsId);
    throw error;
  }
}

// ==================== EXPRESS ROUTES ====================

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    vpsCount: vpsInstances.size,
    onlineVPS: Array.from(vpsInstances.values()).filter(v => v.config.status === 'online').length
  });
});

// Get all VPS
app.get('/vps', (req, res) => {
  res.json(getAllVPSStatus());
});

// Get single VPS
app.get('/vps/:id', (req, res) => {
  const state = vpsInstances.get(req.params.id);
  if (!state) {
    return res.status(404).json({ error: 'VPS not found' });
  }
  res.json({
    config: state.config,
    stats: state.stats,
    accounts: state.accounts,
    lastUpdate: state.lastUpdate
  });
});

// Add new VPS
app.post('/vps', async (req, res) => {
  const { id, name, host, port, apiKey, maxAccounts, region } = req.body;
  
  if (!id || !host || !port) {
    return res.status(400).json({ error: 'id, host, and port are required' });
  }

  if (vpsInstances.has(id)) {
    return res.status(400).json({ error: 'VPS with this ID already exists' });
  }

  const config: VPSConfig = {
    id,
    name: name || `VPS ${id}`,
    host,
    port,
    apiKey,
    status: 'offline',
    maxAccounts: maxAccounts || 20,
    region
  };

  vpsInstances.set(id, {
    config,
    stats: {
      id,
      online: 0,
      offline: 0,
      connecting: 0,
      warming: 0,
      totalMessages: 0,
      healthScore: 0
    },
    accounts: [],
    lastUpdate: new Date()
  });

  await saveConfig();
  addLog('vps', `✅ VPS added: ${name || id}`);
  
  res.json({ success: true, vps: config });
});

// Update VPS config
app.put('/vps/:id', async (req, res) => {
  const state = vpsInstances.get(req.params.id);
  if (!state) {
    return res.status(404).json({ error: 'VPS not found' });
  }

  state.config = { ...state.config, ...req.body };
  await saveConfig();
  
  res.json({ success: true, vps: state.config });
});

// Remove VPS
app.delete('/vps/:id', async (req, res) => {
  if (!vpsInstances.has(req.params.id)) {
    return res.status(404).json({ error: 'VPS not found' });
  }

  const state = vpsInstances.get(req.params.id);
  vpsInstances.delete(req.params.id);
  await saveConfig();
  
  addLog('vps', `🗑️ VPS removed: ${state?.config.name || req.params.id}`);
  res.json({ success: true });
});

// Get all accounts from all VPS
app.get('/accounts', (req, res) => {
  res.json(getAllAccounts());
});

// Get accounts with filtering
app.get('/accounts/light', (req, res) => {
  const { vpsId, pool, status } = req.query;
  
  let accounts = getAllAccounts();
  
  if (vpsId) {
    accounts = accounts.filter(a => a.vpsId === vpsId);
  }
  
  if (pool) {
    accounts = accounts.filter(a => a.pool === pool);
  }
  
  if (status) {
    accounts = accounts.filter(a => a.status === status);
  }
  
  res.json(accounts);
});

// Get aggregated stats
app.get('/stats', (req, res) => {
  res.json(getAggregatedStats());
});

// Get logs
app.get('/logs', (req, res) => {
  res.json(eventLogs.slice(0, 100));
});

// Proxy request to specific VPS
app.post('/vps/:id/proxy/*', async (req, res) => {
  const vpsId = req.params.id;
  const endpoint = req.path.replace(`/vps/${vpsId}/proxy`, '');
  
  try {
    const result = await sendCommandToVPS(vpsId, endpoint, 'POST', req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Session start on specific VPS
app.post('/vps/:id/session/start', async (req, res) => {
  try {
    const result = await sendCommandToVPS(req.params.id, '/session/start', 'POST', req.body);
    addLog('account', `🚀 Session started on ${req.params.id}: ${req.body.accountId}`);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Session stop on specific VPS
app.post('/vps/:id/session/stop', async (req, res) => {
  try {
    const result = await sendCommandToVPS(req.params.id, '/session/stop', 'POST', req.body);
    addLog('account', `🛑 Session stopped on ${req.params.id}: ${req.body.accountId}`);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete account on specific VPS
app.delete('/vps/:id/account/:accountId', async (req, res) => {
  const { id, accountId } = req.params;
  
  try {
    const result = await sendCommandToVPS(id, `/account/${accountId}`, 'DELETE');
    addLog('account', `🗑️ Account deleted on ${id}: ${accountId}`);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Rotate pools on specific VPS
app.post('/vps/:id/pool/rotate', async (req, res) => {
  try {
    const result = await sendCommandToVPS(req.params.id, '/pool/rotate', 'POST');
    addLog('vps', `🔄 Pool rotation on ${req.params.id}`, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Rotate all VPS pools
app.post('/pools/rotate-all', async (req, res) => {
  const results: any[] = [];
  
  for (const [id, state] of vpsInstances) {
    if (state.config.status === 'online') {
      try {
        await sendCommandToVPS(id, '/pool/rotate', 'POST');
        results.push({ vpsId: id, success: true });
      } catch (error: any) {
        results.push({ vpsId: id, success: false, error: error.message });
      }
    }
  }
  
  addLog('info', `🔄 Rotated pools on ${results.filter(r => r.success).length} VPS`);
  res.json({ success: true, results });
});

// Backup all VPS sessions
app.post('/backup/all', async (req, res) => {
  const results: any[] = [];
  
  for (const [id, state] of vpsInstances) {
    if (state.config.status === 'online') {
      try {
        await sendCommandToVPS(id, '/backup/all', 'POST');
        results.push({ vpsId: id, success: true });
      } catch (error: any) {
        results.push({ vpsId: id, success: false, error: error.message });
      }
    }
  }
  
  addLog('info', `💾 Backed up ${results.filter(r => r.success).length} VPS`);
  res.json({ success: true, results });
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send initial state
  socket.emit('init', {
    vps: getAllVPSStatus(),
    accounts: getAllAccounts(),
    stats: getAggregatedStats(),
    logs: eventLogs.slice(0, 50)
  });

  socket.on('refresh', async () => {
    await updateAllVPSStatus();
  });

  socket.on('add-vps', async (data: VPSConfig) => {
    const config: VPSConfig = {
      ...data,
      status: 'offline',
      lastSeen: new Date()
    };

    vpsInstances.set(config.id, {
      config,
      stats: {
        id: config.id,
        online: 0,
        offline: 0,
        connecting: 0,
        warming: 0,
        totalMessages: 0,
        healthScore: 0
      },
      accounts: [],
      lastUpdate: new Date()
    });

    await saveConfig();
    addLog('vps', `✅ VPS added: ${config.name}`);
    io.emit('vps-added', config);
  });

  socket.on('remove-vps', async (vpsId: string) => {
    const state = vpsInstances.get(vpsId);
    vpsInstances.delete(vpsId);
    await saveConfig();
    addLog('vps', `🗑️ VPS removed: ${state?.config.name || vpsId}`);
    io.emit('vps-removed', vpsId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ==================== STARTUP ====================

async function start() {
  await loadConfig();

  httpServer.listen(PORT, () => {
    console.log(`🎯 VPS Manager running on port ${PORT}`);
    addLog('info', '🚀 VPS Manager started');

    // Start polling VPS status
    setInterval(updateAllVPSStatus, 5000);
    updateAllVPSStatus(); // Initial update
  });
}

start().catch(console.error);
